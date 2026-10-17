import ora from 'ora'
import chalk from 'chalk'
import Table from 'cli-table3'
import fs from 'node:fs'
import path from 'node:path'
import { Project, Node, type CallExpression, type Identifier } from 'ts-morph'
import {
  discoverFiles,
  buildProject,
  getImportsForFile,
  getDynamicImportCalls,
  resolveLocalImport,
} from '@/core/parser.js'
import {
  buildGraph,
  findEntryPoints,
  buildReverseGraph,
  isConventionRoutedSourceFile,
  type ImportGraph,
} from '@/core/graph.js'
import { writeJson, writeMarkdown, formatBytes } from '@/core/reporter.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeadExport {
  filePath: string
  exportName: string
  line: number
}

export interface DeadCodeResult {
  safeToDelete: string[]
  transitivelyDead: string[]
  deadFiles: string[]
  liveFiles: Set<string>
  chains: Map<string, string[]>
  deadExports: DeadExport[]
  report: string
}

export interface DeadCodeOptions {
  output?: string
  json?: boolean
}

// ─── Framework / config file patterns ─────────────────────────────────────────

const FRAMEWORK_FILE_PATTERNS = [
  /^next\.config\.(js|ts|mjs|cjs)$/,
  /^middleware\.(ts|js)$/,
  /^instrumentation\.(ts|js)$/,
  /^tailwind\.config\.(js|ts|mjs|cjs)$/,
  /^postcss\.config\.(js|ts|mjs|cjs)$/,
  /^jest\.config\.(js|ts|mjs|cjs)$/,
  /^vitest\.config\.(js|ts|mjs|cjs)$/,
  /^vite\.config\.(js|ts|mjs|cjs)$/,
  /^webpack\.config\.(js|ts|mjs|cjs)$/,
  /^babel\.config\.(js|ts|cjs|mjs|json)$/,
  /^\.babelrc\.(js|cjs)$/,
  /^\.eslintrc\.(js|cjs)$/,
  /^eslint\.config\.(js|ts|mjs|cjs)$/,
  /^prettier\.config\.(js|ts|mjs|cjs)$/,
  /^tsup\.config\.(ts|js)$/,
  /^rollup\.config\.(js|ts|mjs)$/,
  /^esbuild\.config\.(js|ts|mjs)$/,
  /^commitlint\.config\.(js|ts)$/,
  /^lint-staged\.config\.(js|ts|mjs|cjs)$/,
  /^sentry\.(client|server|edge)\.config\.(ts|js)$/,
]

function isFrameworkFile(filePath: string, rootDir: string): boolean {
  const rel = path.relative(rootDir, filePath)
  const basename = path.basename(rel)
  return FRAMEWORK_FILE_PATTERNS.some((re) => re.test(basename))
}

// ─── Public module API ────────────────────────────────────────────────────────

/**
 * Orchestrates the full dead-code analysis pipeline.
 *
 * Uses a reverse-graph approach: a file is "safe to delete" only when NO
 * other file in the codebase imports it AND it is not a known entry point
 * or framework configuration file.
 *
 * After identifying root orphans, iteratively finds files whose EVERY
 * importer is already dead ("transitively dead").
 */
export function runDeadCodeModule(
  project: Project,
  graph: ImportGraph,
  entryPoints: string[],
  rootDir: string,
): DeadCodeResult {
  const allFiles = [...graph.keys()]
  const entrySet = new Set(entryPoints)
  const reverseGraph = buildReverseGraph(graph)

  const excludedFiles = new Set<string>()
  for (const file of allFiles) {
    if (isFrameworkFile(file, rootDir)) excludedFiles.add(file)
  }

  // 1. Safe to Delete: files with zero importers, not entry points, not config
  const safeToDelete = allFiles.filter((f) => {
    if (entrySet.has(f) || excludedFiles.has(f)) return false
    const importers = reverseGraph.get(f)
    return !importers || importers.size === 0
  })

  // 2. Transitively dead: files whose ALL importers are already dead
  const deadSet = new Set(safeToDelete)
  let changed = true
  while (changed) {
    changed = false
    for (const file of allFiles) {
      if (deadSet.has(file) || entrySet.has(file) || excludedFiles.has(file)) continue
      const importers = reverseGraph.get(file)
      if (!importers || importers.size === 0) continue
      if ([...importers].every((imp) => deadSet.has(imp))) {
        deadSet.add(file)
        changed = true
      }
    }
  }

  const transitivelyDead = [...deadSet].filter((f) => !safeToDelete.includes(f))

  // Build chains: for each safe-to-delete root, list transitively dead dependants
  const chains = new Map<string, string[]>()
  for (const root of safeToDelete) {
    const chain = collectTransitiveChain(root, graph, deadSet)
    chains.set(root, chain)
  }

  // Dead exports from live files
  const liveFiles = new Set(allFiles.filter((f) => !deadSet.has(f)))
  const deadExports = findDeadExports(project, liveFiles, rootDir)

  const report = buildDeadCodeReport(
    safeToDelete,
    transitivelyDead,
    chains,
    deadExports,
    rootDir,
  )

  return {
    safeToDelete,
    transitivelyDead,
    deadFiles: [...deadSet],
    liveFiles,
    chains,
    deadExports,
    report,
  }
}

/**
 * Walks forward from a dead root along its imports, collecting only files
 * that are also dead (i.e. would become orphaned if the root is deleted).
 */
function collectTransitiveChain(
  root: string,
  graph: ImportGraph,
  deadSet: Set<string>,
): string[] {
  const chain: string[] = []
  const visited = new Set<string>()
  const stack = [...(graph.get(root) ?? [])]

  let node: string | undefined
  while ((node = stack.pop()) !== undefined) {
    if (visited.has(node) || node === root) continue
    visited.add(node)

    if (deadSet.has(node)) {
      chain.push(node)
      for (const next of graph.get(node) ?? []) {
        if (!visited.has(next)) stack.push(next)
      }
    }
  }

  return chain
}

// ─── Dead exports ─────────────────────────────────────────────────────────────

/**
 * For every live file, finds named exports that are never used (imported by
 * name) by any other live file in the project.
 *
 * Handles: named exports, re-exports, default exports.
 * Skips exports that are pulled in via a namespace import (`import * as X`).
 * A dynamic `import('./x')` uses the exports the code reads from it; when that
 * can't be traced (the module is returned, stored or passed on, as with
 * `React.lazy` or `next/dynamic`), it counts like a namespace import.
 *
 * Skips framework boundary files (`next.config`, `middleware`, …) and
 * convention-routed sources (`pages/`, `src/pages/`, App Router entry files,
 * `src/routes/` …) — their exports are not meant to be imported like normal modules.
 */
export function findDeadExports(
  project: Project,
  liveFiles: Set<string>,
  rootDir: string,
): DeadExport[] {
  const importedNames = buildImportedNameMap(project, liveFiles)
  const dead: DeadExport[] = []

  for (const filePath of liveFiles) {
    if (isFrameworkFile(filePath, rootDir)) continue
    if (isConventionRoutedSourceFile(filePath, rootDir)) continue
    collectFileDeadExports(filePath, project, importedNames, dead)
  }

  return dead
}

function collectFileDeadExports(
  filePath: string,
  project: Project,
  importedNames: Map<string, Set<string>>,
  dead: DeadExport[],
): void {
  const sf = project.getSourceFile(filePath)
  if (!sf) return

  const usedNames = importedNames.get(filePath) ?? new Set<string>()
  if (usedNames.has('*')) return

  for (const [exportName, declarations] of sf.getExportedDeclarations()) {
    if (usedNames.has(exportName)) continue
    const line = getExportLine(declarations[0])
    dead.push({ filePath, exportName, line })
  }
}

function getExportLine(decl: import('ts-morph').ExportedDeclarations): number {
  if (!decl) return 0
  if (!Node.isNode(decl)) return 0
  return decl.getStartLineNumber()
}

/**
 * Returns the size of `filePath` in bytes, or 0 if the file cannot be read.
 */
export function getFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

// ─── Report builder ───────────────────────────────────────────────────────────

const RULE = '─'.repeat(78)
const RULE2 = '═'.repeat(78)

export function buildDeadCodeReport(
  safeToDelete: string[],
  transitivelyDead: string[],
  chains: Map<string, string[]>,
  deadExports: DeadExport[],
  rootDir: string,
): string {
  const rel = (p: string) => path.relative(rootDir, p).replaceAll('\\', '/')

  const sortPaths = (paths: string[]) =>
    [...paths].sort((a, b) => rel(a).localeCompare(rel(b), 'en'))

  const safeSorted = sortPaths(safeToDelete)
  const transSorted = sortPaths(transitivelyDead)

  const safeBytes = safeSorted.reduce((s, f) => s + getFileSize(f), 0)
  const transBytes = transSorted.reduce((s, f) => s + getFileSize(f), 0)
  const fileDeleteBytes = safeBytes + transBytes
  const totalKb = (fileDeleteBytes / 1024).toFixed(1)

  const deadExportFiles = new Set(deadExports.map((e) => e.filePath))
  const deadExportFileBytes = [...deadExportFiles].reduce((s, f) => s + getFileSize(f), 0)

  const lines: string[] = [
    RULE2,
    '  DEAD CODE REPORT',
    RULE2,
    `  Safe to delete     : ${safeToDelete.length}`,
    `  Transitively dead  : ${transitivelyDead.length}`,
    `  Dead exports       : ${deadExports.length}`,
    `  Recoverable (files): ~${totalKb} KB  (${formatBytes(fileDeleteBytes)})`,
    RULE2,
    '',
    '  HOW TO READ THIS',
    '',
    '  1. SAFE TO DELETE — No other source file imports these. You can delete them',
    '     first (after review).',
    '  2. TRANSITIVELY DEAD — Only referenced by files that are already dead. After',
    '     removing safe-to-delete files, these become removable too.',
    '  3. DEAD EXPORTS — The file is still used, but the listed export is never',
    '     imported by name. Remove the export (or use it) to tidy the API.',
    '     Framework routes (pages/, app/, etc.) are not listed here.',
    '',
    RULE,
    '',
  ]

  if (safeSorted.length > 0) {
    lines.push(
      '── SAFE TO DELETE ──',
      '',
      '  Nothing in the project imports these paths. Review, then delete.',
      '',
    )
    for (const filePath of safeSorted) {
      const chain = chains.get(filePath) ?? []
      const kb = (getFileSize(filePath) / 1024).toFixed(1)
      lines.push(`  • ${rel(filePath)}  (~${kb} KB)`)
      if (chain.length > 0) {
        lines.push(
          `      ↳ Also becomes orphaned if you delete the line above:`,
          `        ${chain.map(rel).join(', ')}`,
        )
      }
    }
    lines.push(
      '',
      `  SUBTOTAL — ${safeSorted.length} file(s) · ${formatBytes(safeBytes)}`,
      '',
      RULE,
      '',
    )
  }

  if (transSorted.length > 0) {
    lines.push(
      '── TRANSITIVELY DEAD ──',
      '',
      '  Every importer of these files is already in the dead set above.',
      '',
    )
    for (const filePath of transSorted) {
      const kb = (getFileSize(filePath) / 1024).toFixed(1)
      lines.push(`  • ${rel(filePath)}  (~${kb} KB)`)
    }
    lines.push(
      '',
      `  SUBTOTAL — ${transSorted.length} file(s) · ${formatBytes(transBytes)}`,
      '',
      RULE,
      '',
    )
  }

  if (deadExports.length > 0) {
    lines.push(
      '── DEAD EXPORTS ──',
      '',
      '  Symbol is exported but never imported by name elsewhere (namespace imports,',
      '  and import() calls whose use can’t be traced, count as “all used”).',
      '  Route and framework files are excluded.',
      '',
    )
    const byFile = new Map<string, DeadExport[]>()
    for (const e of deadExports) {
      if (!byFile.has(e.filePath)) byFile.set(e.filePath, [])
      byFile.get(e.filePath)!.push(e)
    }
    const fileKeys = [...byFile.keys()].sort((a, b) => rel(a).localeCompare(rel(b), 'en'))
    for (const fp of fileKeys) {
      lines.push(`  ${rel(fp)}`)
      for (const entry of byFile.get(fp)!) {
        lines.push(`      • export “${entry.exportName}”  (line ${entry.line})`)
      }
      lines.push('')
    }
    lines.push(
      `  SUBTOTAL — ${deadExports.length} export(s) across ${deadExportFiles.size} file(s)`,
      '',
      RULE,
      '',
    )
  }

  lines.push(
    RULE2,
    '  END OF REPORT — DISK SPACE & CLEANUP SUMMARY',
    RULE2,
    '',
    '  If you DELETE every file under “Safe to delete” and “Transitively dead”:',
    '',
    `      Files removed : ${safeSorted.length + transSorted.length}`,
    `      Disk freed    : ${formatBytes(fileDeleteBytes)}  (approx., from file sizes on disk)`,
    '',
    '  Dead exports do not remove whole files by themselves. Cleaning them saves',
    `  maintainability first; the ${deadExportFiles.size} file(s) that contain them`,
    `  total about ${formatBytes(deadExportFileBytes)} on disk (entire files, not`,
    '  “export-only” savings).',
    '',
    '  Suggested order: (1) Delete safe-to-delete files → (2) Delete transitively',
    '  dead files → (3) Remove or use dead exports in remaining files.',
    '',
    RULE2,
    '',
  )

  return lines.join('\n')
}

// ─── CLI command (backward-compatible) ───────────────────────────────────────

interface DeadExportRow {
  file: string
  exportName: string
}

export async function runDeadCode(dir: string, opts: DeadCodeOptions): Promise<DeadExportRow[]> {
  const spinner = ora(chalk.cyan('Scanning for dead code…')).start()

  try {
    const fileList = discoverFiles(dir, [])
    const project = buildProject(fileList)
    const graph = buildGraph(fileList, (f) => {
      const sf = project.getSourceFile(f)
      return sf ? getImportsForFile(sf) : []
    })

    const packageJson = loadPackageJson(dir)
    const entries = findEntryPoints(dir, packageJson)

    const result = runDeadCodeModule(project, graph, entries, dir)

    const dead: DeadExportRow[] = [
      ...result.safeToDelete.map((f) => ({ file: f, exportName: '(entire file — safe to delete)' })),
      ...result.transitivelyDead.map((f) => ({ file: f, exportName: '(entire file — transitively dead)' })),
      ...result.deadExports.map((e) => ({ file: e.filePath, exportName: e.exportName })),
    ]

    spinner.succeed(chalk.green(`Dead code scan complete — ${dead.length} item(s) found`))

    if (dead.length === 0) {
      console.log(chalk.green('  No dead code detected.'))
      return dead
    }

    printDeadTable(dead)
    writeDeadOutput(result, opts)

    return dead
  } catch (err) {
    spinner.fail(chalk.red('Dead code scan failed'))
    throw err
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildImportedNameMap(
  project: Project,
  liveFiles: Set<string>,
): Map<string, Set<string>> {
  const importedNames = new Map<string, Set<string>>()

  const touch = (file: string, name: string) => {
    if (!importedNames.has(file)) importedNames.set(file, new Set())
    importedNames.get(file)!.add(name)
  }

  for (const filePath of liveFiles) {
    const sf = project.getSourceFile(filePath)
    if (!sf) continue
    processImports(sf, touch)
    processReExports(sf, touch)
    processDynamicImports(sf, touch)
  }

  return importedNames
}

function processImports(
  sf: ReturnType<Project['getSourceFiles']>[number],
  touch: (file: string, name: string) => void,
): void {
  for (const decl of sf.getImportDeclarations()) {
    const resolved = decl.getModuleSpecifierSourceFile()
    if (!resolved) continue
    const target = resolved.getFilePath()

    if (decl.getNamespaceImport()) {
      touch(target, '*')
      continue
    }

    const defaultImport = decl.getDefaultImport()
    if (defaultImport) touch(target, 'default')

    // `import { a as b }` uses the export `a`; `b` is only the local name.
    for (const named of decl.getNamedImports()) {
      touch(target, named.getName())
    }
  }
}

function processReExports(
  sf: ReturnType<Project['getSourceFiles']>[number],
  touch: (file: string, name: string) => void,
): void {
  for (const decl of sf.getExportDeclarations()) {
    const resolved = decl.getModuleSpecifierSourceFile()
    if (!resolved) continue
    const target = resolved.getFilePath()

    if (decl.isNamespaceExport()) {
      touch(target, '*')
      continue
    }

    for (const named of decl.getNamedExports()) {
      touch(target, named.getName())
    }
  }
}

/**
 * `import('./x')` uses the exports the code reads from the module. When that
 * can't be traced, every export counts as used, the same as a namespace import.
 */
function processDynamicImports(
  sf: ReturnType<Project['getSourceFiles']>[number],
  touch: (file: string, name: string) => void,
): void {
  for (const { call, specifier } of getDynamicImportCalls(sf)) {
    // Resolved the same way the import graph resolves it, so a file can't be kept
    // live by a dynamic import that this map doesn't see.
    const resolved = resolveLocalImport(sf, specifier)
    const targetFile = resolved ? sf.getProject().getSourceFile(resolved) : undefined
    if (!targetFile) continue
    const target = targetFile.getFilePath()

    const names = namesReadFromDynamicImport(call)
    if (names === null) {
      touch(target, '*')
      continue
    }
    for (const name of names) touch(target, name)
  }
}

/**
 * The exports read from the module an `import()` call loads. Understands:
 *
 *   import('./x').then((m) => m.a)        import('./x').then(({ a }) => …)
 *   const { a } = await import('./x')     (await import('./x')).a
 *   const m = await import('./x'); m.a
 *
 * Returns null for anything else, e.g. the module is returned, stored or passed
 * on (`lazy(() => import('./x'))`), which the caller treats as "all used".
 */
function namesReadFromDynamicImport(call: CallExpression): string[] | null {
  const promise = outermostParens(call)
  const parent = promise.getParent()

  // import('./x').then(callback)
  if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === promise) {
    const thenCall = parent.getParent()
    if (
      parent.getName() !== 'then' ||
      !Node.isCallExpression(thenCall) ||
      thenCall.getExpression() !== parent
    ) {
      return null
    }
    const [callback] = thenCall.getArguments()
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) return null
    const [param] = callback.getParameters()
    return param ? namesReadThroughBinding(param.getNameNode()) : []
  }

  // await import('./x')
  if (!Node.isAwaitExpression(parent)) return null
  const awaited = outermostParens(parent)
  const user = awaited.getParent()

  if (Node.isPropertyAccessExpression(user) && user.getExpression() === awaited) {
    return [user.getName()]
  }
  if (Node.isElementAccessExpression(user) && user.getExpression() === awaited) {
    const key = literalKey(user.getArgumentExpression())
    return key === null ? null : [key]
  }
  if (Node.isVariableDeclaration(user) && user.getInitializer() === awaited) {
    return namesReadThroughBinding(user.getNameNode())
  }
  return null
}

/** Names read through a binding of the module: `{ a, b: c }`, or a plain identifier. */
function namesReadThroughBinding(name: Node): string[] | null {
  if (Node.isIdentifier(name)) return propertiesReadFrom(name)
  if (!Node.isObjectBindingPattern(name)) return null

  const names: string[] = []
  for (const element of name.getElements()) {
    if (element.getDotDotDotToken()) return null
    const key = element.getPropertyNameNode()
    if (!key) {
      names.push(element.getName())
    } else if (Node.isIdentifier(key)) {
      names.push(key.getText())
    } else if (Node.isStringLiteral(key)) {
      names.push(key.getLiteralValue())
    } else {
      return null
    }
  }
  return names
}

/**
 * The properties read off a variable that holds the module (`m.a`, `m['a']`), or
 * null if the variable is used any other way.
 */
function propertiesReadFrom(id: Identifier): string[] | null {
  const names: string[] = []
  for (const ref of id.findReferencesAsNodes()) {
    if (ref === id) continue
    const parent = ref.getParent()
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === ref) {
      names.push(parent.getName())
      continue
    }
    if (Node.isElementAccessExpression(parent) && parent.getExpression() === ref) {
      const key = literalKey(parent.getArgumentExpression())
      if (key === null) return null
      names.push(key)
      continue
    }
    return null
  }
  return names
}

function literalKey(node: Node | undefined): string | null {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)
    ? node.getLiteralValue()
    : null
}

function outermostParens(node: Node): Node {
  let current = node
  let parent = current.getParent()
  while (parent && Node.isParenthesizedExpression(parent)) {
    current = parent
    parent = current.getParent()
  }
  return current
}

function loadPackageJson(dir: string): unknown {
  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) return null
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
}

function printDeadTable(dead: Array<{ file: string; exportName: string }>): void {
  const table = new Table({ head: ['File', 'Export'] })
  for (const row of dead) {
    table.push([row.file, row.exportName])
  }
  console.log(table.toString())
}

function writeDeadOutput(result: DeadCodeResult, opts: DeadCodeOptions): void {
  if (!opts.output) return

  if (opts.json) {
    writeJson(
      {
        safeToDelete: result.safeToDelete,
        transitivelyDead: result.transitivelyDead,
        deadExports: result.deadExports,
      },
      opts.output,
    )
    console.log(chalk.cyan(`  JSON written to ${opts.output}`))
    return
  }

  writeMarkdown(
    {
      title: 'Dead Code Report',
      summary: `${result.safeToDelete.length} safe to delete, ${result.transitivelyDead.length} transitively dead, ${result.deadExports.length} dead export(s)`,
      sections: [
        {
          title: 'Safe to Delete',
          headers: ['File', 'Chain'],
          rows: result.safeToDelete.map((f) => [
            f,
            (result.chains.get(f) ?? []).join(' → ') || '—',
          ]),
        },
        {
          title: 'Transitively Dead',
          headers: ['File'],
          rows: result.transitivelyDead.map((f) => [f]),
        },
        {
          title: 'Dead Exports',
          headers: ['File', 'Export', 'Line'],
          rows: result.deadExports.map((e) => [e.filePath, e.exportName, String(e.line)]),
        },
      ],
      generatedAt: new Date(),
    },
    opts.output,
  )
  console.log(chalk.cyan(`  Report written to ${opts.output}`))
}
