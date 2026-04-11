import ora from 'ora'
import chalk from 'chalk'
import Table from 'cli-table3'
import fs from 'node:fs'
import path from 'node:path'
import { Project, Node } from 'ts-morph'
import { discoverFiles, buildProject, getImportsForFile } from '@/core/parser.js'
import {
  buildGraph,
  findEntryPoints,
  findDeadChains,
  findRootFiles,
  runDFS,
  type ImportGraph,
} from '@/core/graph.js'
import { writeJson, writeMarkdown } from '@/core/reporter.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeadExport {
  filePath: string
  exportName: string
  line: number
}

export interface DeadCodeResult {
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

// ─── Public module API ────────────────────────────────────────────────────────

/**
 * Orchestrates the full dead-code analysis pipeline.
 *
 * @param project      - A ts-morph Project containing all source files.
 * @param graph        - Pre-built import graph.
 * @param entryPoints  - Files to treat as reachable roots.
 * @param rootDir      - Project root (used for relative path display).
 */
export function runDeadCodeModule(
  project: Project,
  graph: ImportGraph,
  entryPoints: string[],
  rootDir: string,
): DeadCodeResult {
  const allFiles = [...graph.keys()]
  const effectiveEntries = entryPoints.length > 0 ? entryPoints : findRootFiles(graph)

  const liveFiles = runDFS(graph, effectiveEntries)
  const deadFiles = allFiles.filter((f) => !liveFiles.has(f))
  const deadSet = new Set(deadFiles)

  const chains = findDeadChains(graph, deadSet)
  const deadExports = findDeadExports(project, liveFiles)
  const report = buildDeadCodeReport(deadFiles, chains, deadExports, rootDir)

  return { deadFiles, liveFiles, chains, deadExports, report }
}

/**
 * For every live file, finds named exports that are never used (imported by
 * name) by any other live file in the project.
 *
 * Handles: named exports, re-exports, default exports.
 * Skips exports that are pulled in via a namespace import (`import * as X`).
 */
export function findDeadExports(
  project: Project,
  liveFiles: Set<string>,
): DeadExport[] {
  const importedNames = buildImportedNameMap(project, liveFiles)
  const dead: DeadExport[] = []

  for (const filePath of liveFiles) {
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

/**
 * Builds a human-readable plain-text report suitable for writing to
 * `code_cleaning.txt`.
 */
export function buildDeadCodeReport(
  deadFiles: string[],
  chains: Map<string, string[]>,
  deadExports: DeadExport[],
  rootDir: string,
): string {
  const rel = (p: string) => path.relative(rootDir, p).replaceAll('\\', '/')

  const totalBytes = deadFiles.reduce((sum, f) => {
    const chain = chains.get(f) ?? []
    return sum + getFileSize(f) + chain.reduce((s, c) => s + getFileSize(c), 0)
  }, 0)
  const totalKb = (totalBytes / 1024).toFixed(1)

  const lines: string[] = [
    '========================================',
    '  DEAD CODE REPORT',
    `  Dead files : ${deadFiles.length}`,
    `  Dead exports: ${deadExports.length}`,
    `  Recoverable : ~${totalKb} KB`,
    '========================================',
    '',
  ]

  if (deadFiles.length > 0) {
    lines.push('── DEAD FILES ──', '')
    for (const filePath of deadFiles) {
      const chain = chains.get(filePath) ?? []
      const allFiles = [filePath, ...chain]
      const sizeBytes = allFiles.reduce((s, f) => s + getFileSize(f), 0)
      const sizeKb = (sizeBytes / 1024).toFixed(1)
      const chainStr =
        chain.length > 0
          ? [rel(filePath), ...chain.map(rel)].join(' → ')
          : rel(filePath)

      const plural = allFiles.length === 1 ? '' : 's'

      lines.push(
        `DEAD FILE — ${rel(filePath)}`,
        `Reason: Not imported anywhere in the codebase`,
        `Chain: ${chainStr}`,
        `Size: ~${sizeKb} KB removable across ${allFiles.length} file${plural}`,
        `Action: Safe to delete all ${allFiles.length} file${plural}`,
        '',
      )
    }
  }

  if (deadExports.length > 0) {
    lines.push('── DEAD EXPORTS ──', '')
    for (const entry of deadExports) {
      lines.push(
        `DEAD EXPORT — ${rel(entry.filePath)} → ${entry.exportName}() [line ${entry.line}]`,
        `Reason: Exported but never imported`,
        `Action: Remove the export (file itself is still live)`,
        '',
      )
    }
  }

  return lines.join('\n')
}

// ─── CLI command (backward-compatible) ───────────────────────────────────────

/** Legacy interface used by the CLI table printer. */
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

    // Flatten dead files → rows
    const dead: DeadExportRow[] = [
      ...result.deadFiles.map((f) => ({ file: f, exportName: '(entire file)' })),
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

/**
 * Builds a map of `filePath → Set<exportName>` for every name that is
 * imported from that file by any live file.  A `*` entry means the file is
 * namespace-imported and all its exports are considered used.
 */
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

    for (const named of decl.getNamedImports()) {
      touch(target, named.getAliasNode()?.getText() ?? named.getName())
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
      { deadFiles: result.deadFiles, deadExports: result.deadExports },
      opts.output,
    )
    console.log(chalk.cyan(`  JSON written to ${opts.output}`))
    return
  }

  writeMarkdown(
    {
      title: 'Dead Code Report',
      summary: `${result.deadFiles.length} dead file(s), ${result.deadExports.length} dead export(s)`,
      sections: [
        {
          title: 'Dead Files',
          headers: ['File', 'Chain'],
          rows: result.deadFiles.map((f) => [
            f,
            (result.chains.get(f) ?? []).join(' → ') || '—',
          ]),
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
