import ora from 'ora'
import chalk from 'chalk'
import Table from 'cli-table3'
import fs from 'node:fs'
import { Project, SyntaxKind, VariableDeclarationKind } from 'ts-morph'
import { glob } from '@/utils/file.js'
import { hashFunctionBody, isExported } from '@/utils/ast.js'
import { writeMarkdown } from '@/core/reporter.js'
import { dupeClusterPrompt } from '@/prompt-gen/templates.js'

export interface DupeFinderOptions {
  output?: string
  minLines?: string
}

export interface DuplicateBlock {
  hash: string
  lines: number
  occurrences: Array<{ file: string; startLine: number }>
}

// Minimum number of meaningful (non-whitespace) characters a block must have
// to be worth reporting. Filters out blocks that are all braces/imports/short lines.
const MIN_BLOCK_CHARS = 120

/**
 * Detects duplicate code blocks across files using a rolling line-hash approach.
 */
export async function runDupeFinder(dir: string, opts: DupeFinderOptions): Promise<DuplicateBlock[]> {
  const minLines = parseInt(opts.minLines ?? '15', 10)
  const spinner = ora(chalk.cyan(`Scanning for duplicate blocks (≥${minLines} lines)…`)).start()

  try {
    const files = glob(dir, ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'], [
      'node_modules', 'dist', '.next', 'coverage',
      '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx',
      '**/*.d.ts',
    ])
    const blockMap = new Map<string, Array<{ file: string; startLine: number }>>()

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)

      for (let i = 0; i <= lines.length - minLines; i++) {
        const block = lines.slice(i, i + minLines).join('\n')
        // Skip blocks that are mostly boilerplate / too short to be meaningful
        const meaningfulChars = block.replace(/[\s{}();,]/g, '').length
        if (meaningfulChars < MIN_BLOCK_CHARS) continue
        if (!blockMap.has(block)) blockMap.set(block, [])
        blockMap.get(block)!.push({ file: filePath, startLine: i + 1 })
      }
    }

    const dupes: DuplicateBlock[] = []

    for (const [block, occurrences] of blockMap) {
      if (occurrences.length > 1) {
        dupes.push({
          hash: hashString(block),
          lines: minLines,
          occurrences,
        })
      }
    }

    // Sort by most occurrences first, cap at 200 to keep reports readable
    dupes.sort((a, b) => b.occurrences.length - a.occurrences.length)
    if (dupes.length > 200) dupes.splice(200)

    spinner.succeed(chalk.green(`Duplicate scan complete — ${dupes.length} duplicate block(s) found`))

    if (dupes.length === 0) {
      console.log(chalk.green('  No duplicate blocks detected.'))
      return dupes
    }

    const table = new Table({ head: ['Hash', 'Lines', 'Count', 'First Occurrence'] })
    for (const d of dupes) {
      table.push([
        chalk.gray(d.hash.slice(0, 8)),
        String(d.lines),
        chalk.yellow(String(d.occurrences.length)),
        `${d.occurrences[0].file}:${d.occurrences[0].startLine}`,
      ])
    }
    console.log(table.toString())

    if (opts.output) {
      const rows = dupes.flatMap((d) =>
        d.occurrences.map((o) => [d.hash.slice(0, 8), String(d.lines), o.file, String(o.startLine)]),
      )
      writeMarkdown(
        {
          title: 'Duplicate Code Report',
          summary: `${dupes.length} duplicate block(s) found (min lines: ${minLines})`,
          sections: [{ title: 'Duplicates', headers: ['Hash', 'Lines', 'File', 'Start Line'], rows }],
          generatedAt: new Date(),
        },
        opts.output,
      )
      console.log(chalk.cyan(`  Report written to ${opts.output}`))
    }

    return dupes
  } catch (err) {
    spinner.fail(chalk.red('Duplicate scan failed'))
    throw err
  }
}

function hashString(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ─── AST-based duplicate detection ───────────────────────────────────────────

export interface FunctionRecord {
  name: string
  filePath: string
  line: number
  bodyHash: string
  paramCount: number
}

export interface DupeCluster {
  type: 'name' | 'structure'
  functions: FunctionRecord[]
}

export interface ConstDupe {
  name: string
  value: string
  occurrences: Array<{ filePath: string; line: number }>
}

/**
 * Extracts named function declarations and exported const arrow functions from
 * all live files in the project, computing an AST body hash for each.
 */
export function extractFunctions(project: Project, liveFiles: Set<string>): FunctionRecord[] {
  const records: FunctionRecord[] = []

  for (const filePath of liveFiles) {
    const sf = project.getSourceFile(filePath)
    if (!sf) continue

    // Named function declarations
    for (const fn of sf.getFunctions()) {
      const name = fn.getName()
      if (!name) continue
      records.push({
        name,
        filePath,
        line: fn.getStartLineNumber(),
        bodyHash: hashFunctionBody(fn),
        paramCount: fn.getParameters().length,
      })
    }

    // Exported const arrow functions
    for (const stmt of sf.getVariableStatements()) {
      if (stmt.getDeclarationKind() !== VariableDeclarationKind.Const) continue
      if (!isExported(stmt)) continue

      for (const decl of stmt.getDeclarations()) {
        const arrowFn = decl.getInitializer()?.asKind(SyntaxKind.ArrowFunction)
        if (!arrowFn) continue
        records.push({
          name: decl.getName(),
          filePath,
          line: decl.getStartLineNumber(),
          bodyHash: hashFunctionBody(arrowFn),
          paramCount: arrowFn.getParameters().length,
        })
      }
    }
  }

  return records
}

/**
 * Groups functions whose names have a Levenshtein distance ≤ 2 using
 * union-find (transitive closure). Returns only clusters of ≥ 2 functions.
 */
export function clusterByName(functions: FunctionRecord[]): DupeCluster[] {
  const n = functions.length
  const parent = Array.from({ length: n }, (_, i) => i)

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (levenshtein(functions[i]!.name, functions[j]!.name) <= 2) {
        parent[find(i)] = find(j)
      }
    }
  }

  const groups = new Map<number, FunctionRecord[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const group = groups.get(root) ?? []
    group.push(functions[i]!)
    groups.set(root, group)
  }

  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({ type: 'name' as const, functions: g }))
}

/**
 * Groups functions with identical body hashes.
 * Returns only clusters of ≥ 2 functions.
 */
export function clusterByStructure(functions: FunctionRecord[]): DupeCluster[] {
  const groups = new Map<string, FunctionRecord[]>()

  for (const fn of functions) {
    if (!fn.bodyHash) continue
    const group = groups.get(fn.bodyHash) ?? []
    group.push(fn)
    groups.set(fn.bodyHash, group)
  }

  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({ type: 'structure' as const, functions: g }))
}

/**
 * Finds `const` declarations that share the same name AND literal value
 * across multiple live files.
 */
export function findDuplicateConstants(
  project: Project,
  liveFiles: Set<string>,
): ConstDupe[] {
  const map = new Map<string, Array<{ filePath: string; line: number }>>()

  for (const filePath of liveFiles) {
    const sf = project.getSourceFile(filePath)
    if (!sf) continue

    for (const stmt of sf.getVariableStatements()) {
      if (stmt.getDeclarationKind() !== VariableDeclarationKind.Const) continue

      for (const decl of stmt.getDeclarations()) {
        const name = decl.getName()
        const value = getLiteralValue(decl.getInitializer())
        if (!value) continue

        const key = JSON.stringify({ name, value })
        const existing = map.get(key) ?? []
        existing.push({ filePath, line: decl.getStartLineNumber() })
        map.set(key, existing)
      }
    }
  }

  const result: ConstDupe[] = []
  for (const [key, occurrences] of map) {
    if (occurrences.length < 2) continue
    const { name, value } = JSON.parse(key) as { name: string; value: string }
    result.push({ name, value, occurrences })
  }
  return result
}

/**
 * Builds a human-readable plain-text report for code_suggest.txt, including
 * an AI prompt for each cluster.
 */
export function buildDupeReport(clusters: DupeCluster[], constDupes: ConstDupe[]): string {
  const lines: string[] = [
    '========================================',
    '  DUPLICATE CODE REPORT',
    `  Function clusters : ${clusters.length}`,
    `  Const duplicates  : ${constDupes.length}`,
    '========================================',
    '',
  ]

  if (clusters.length > 0) {
    lines.push('── FUNCTION CLUSTERS ──', '')
    for (const cluster of clusters) {
      const label = cluster.type === 'name' ? 'Similar Name' : 'Identical Structure'
      lines.push(`CLUSTER [${label}]`)
      for (const fn of cluster.functions) {
        lines.push(`  ${fn.name}  ${fn.filePath}:${fn.line}  (params: ${fn.paramCount})`)
      }
      lines.push('')
      lines.push('AI SUGGESTION:', dupeClusterPrompt([cluster]), '')
    }
  }

  if (constDupes.length > 0) {
    lines.push('── DUPLICATE CONSTANTS ──', '')
    for (const d of constDupes) {
      lines.push(`CONST ${d.name} = ${d.value}`)
      for (const o of d.occurrences) {
        lines.push(`  ${o.filePath}:${o.line}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const ma = a.length
  const mb = b.length
  let prev = Array.from({ length: mb + 1 }, (_, j) => j)

  for (let i = 1; i <= ma; i++) {
    const curr: number[] = [i]
    for (let j = 1; j <= mb; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j]!, curr[j - 1]!, prev[j - 1]!)
    }
    prev = curr
  }

  return prev[mb]!
}

function getLiteralValue(node: ReturnType<import('ts-morph').VariableDeclaration['getInitializer']>): string | undefined {
  if (!node) return undefined
  const kind = node.getKind()
  if (
    kind === SyntaxKind.StringLiteral ||
    kind === SyntaxKind.NumericLiteral ||
    kind === SyntaxKind.TrueKeyword ||
    kind === SyntaxKind.FalseKeyword ||
    kind === SyntaxKind.NoSubstitutionTemplateLiteral
  ) {
    return node.getText()
  }
  return undefined
}
