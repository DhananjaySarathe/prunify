import fs from 'node:fs'
import path from 'node:path'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Directed adjacency list: file path â†’ set of file paths it imports.
 */
export type ImportGraph = Map<string, Set<string>>

export interface GraphAnalysis {
  deadFiles: string[]
  liveFiles: string[]
  cycles: string[][]
}

// â”€â”€â”€ Core functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Builds a directed `ImportGraph` from a list of file paths.
 *
 * @param files      - All files that should be nodes in the graph.
 * @param getImports - Returns the resolved absolute import paths for a file.
 */
export function buildGraph(
  files: string[],
  getImports: (file: string) => string[],
): ImportGraph {
  const graph: ImportGraph = new Map()

  for (const file of files) {
    graph.set(file, new Set())
  }

  for (const file of files) {
    for (const imported of getImports(file)) {
      graph.get(file)?.add(imported)
      // Ensure imported node exists even if it wasn't in the initial list
      if (!graph.has(imported)) graph.set(imported, new Set())
    }
  }

  return graph
}

/**
 * Resolves the entry points for a project.
 *
 * Resolution order:
 *  1. Next.js: all files inside `pages/` and `app/` directories.
 *  2. package.json `"main"` and `"module"` fields.
 *  3. Vite / generic fallback: `src/main.ts`, `src/main.tsx`, `src/index.ts`,
 *     `src/index.tsx`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findEntryPoints(rootDir: string, packageJson: any): string[] {
  const entries = [
    ...resolveNextJsEntries(rootDir),
    ...resolvePkgFieldEntries(rootDir, packageJson),
  ]

  if (entries.length === 0) {
    const fallback = resolveFallbackEntry(rootDir)
    if (fallback) entries.push(fallback)
  }

  return [...new Set(entries)]
}

/**
 * Iterative DFS from all `entryPoints`, returning every reachable file.
 * Safe against circular references.
 */
export function runDFS(graph: ImportGraph, entryPoints: string[]): Set<string> {
  const visited = new Set<string>()
  const stack = [...entryPoints]
  let node: string | undefined

  while ((node = stack.pop()) !== undefined) {
    if (visited.has(node)) continue
    visited.add(node)
    for (const neighbor of graph.get(node) ?? []) {
      if (!visited.has(neighbor)) stack.push(neighbor)
    }
  }

  return visited
}

/**
 * For each dead file, finds its full dead chain: files that are transitively
 * imported only by other dead files (i.e. removing the dead root would also
 * make them unreachable from any live entry point).
 *
 * Returns `Map<deadFile, chainMembers[]>`.
 */
export function findDeadChains(
  graph: ImportGraph,
  deadFiles: Set<string>,
): Map<string, string[]> {
  const reverseGraph = buildReverseGraph(graph)
  const result = new Map<string, string[]>()

  for (const deadRoot of deadFiles) {
    result.set(deadRoot, dfsDeadChain(deadRoot, graph, deadFiles, reverseGraph))
  }

  return result
}

/**
 * Detects all circular dependency chains using iterative DFS with an explicit
 * path stack. Duplicate cycles (the same cycle starting at a different node)
 * are deduplicated by normalising to the lexicographically smallest rotation.
 */
export function detectCycles(graph: ImportGraph): string[][] {
  const cycles: string[][] = []
  const seenKeys = new Set<string>()
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const path: string[] = []

  const acc: CycleAccumulator = { seenKeys, cycles }

  for (const start of graph.keys()) {
    if (!visited.has(start)) {
      dfsForCycles(start, graph, visited, inStack, path, acc)
    }
  }

  return cycles
}

// â”€â”€â”€ Legacy aliases (used by existing modules) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** @deprecated Use `runDFS` instead. */
export function dfs(start: string, graph: ImportGraph): Set<string> {
  return runDFS(graph, [start])
}

/** @deprecated Use `detectCycles` instead. */
export function findCircularGroups(graph: ImportGraph): string[][] {
  return detectCycles(graph)
}

// â”€â”€â”€ Entry-point resolution helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function resolveNextJsEntries(rootDir: string): string[] {
  const isNext =
    fs.existsSync(path.join(rootDir, 'next.config.js')) ||
    fs.existsSync(path.join(rootDir, 'next.config.ts')) ||
    fs.existsSync(path.join(rootDir, 'next.config.mjs'))

  if (!isNext) return []

  const entries: string[] = []
  for (const dir of ['pages', 'app'] as const) {
    const dirPath = path.join(rootDir, dir)
    if (fs.existsSync(dirPath)) entries.push(...collectSourceFiles(dirPath))
  }
  return entries
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolvePkgFieldEntries(rootDir: string, packageJson: any): string[] {
  const entries: string[] = []
  for (const field of ['main', 'module'] as const) {
    const value = packageJson?.[field]
    if (typeof value !== 'string') continue
    const abs = path.resolve(rootDir, value)
    if (fs.existsSync(abs)) entries.push(abs)
  }
  return entries
}

function resolveFallbackEntry(rootDir: string): string | undefined {
  const fallbacks = ['src/main.ts', 'src/main.tsx', 'src/index.ts', 'src/index.tsx']
  for (const rel of fallbacks) {
    const abs = path.join(rootDir, rel)
    if (fs.existsSync(abs)) return abs
  }
  return undefined
}

// â”€â”€â”€ Cycle detection helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type CycleFrame = { node: string; neighbors: Iterator<string>; entered: boolean }
type CycleAccumulator = { seenKeys: Set<string>; cycles: string[][] }

function mkFrame(node: string, graph: ImportGraph): CycleFrame {
  return { node, neighbors: (graph.get(node) ?? new Set()).values(), entered: false }
}

function dfsForCycles(
  start: string,
  graph: ImportGraph,
  visited: Set<string>,
  inStack: Set<string>,
  path: string[],
  acc: CycleAccumulator,
): void {
  const stack: CycleFrame[] = [mkFrame(start, graph)]

  while (stack.length > 0) {
    const frame = stack.at(-1)
    if (!frame) break

    if (!frame.entered) {
      if (visited.has(frame.node)) { stack.pop(); continue }
      frame.entered = true
      inStack.add(frame.node)
      path.push(frame.node)
    }

    const { done, value: neighbor } = frame.neighbors.next()

    if (done) {
      stack.pop()
      path.pop()
      inStack.delete(frame.node)
      visited.add(frame.node)
    } else {
      handleCycleNeighbor(neighbor, stack, path, inStack, visited, acc, graph)
    }
  }
}

function handleCycleNeighbor(
  neighbor: string,
  stack: CycleFrame[],
  path: string[],
  inStack: Set<string>,
  visited: Set<string>,
  acc: CycleAccumulator,
  graph: ImportGraph,
): void {
  if (inStack.has(neighbor)) {
    recordCycle(neighbor, path, acc)
  } else if (!visited.has(neighbor)) {
    stack.push(mkFrame(neighbor, graph))
  }
}

function recordCycle(
  cycleStart: string,
  path: string[],
  acc: CycleAccumulator,
): void {
  const idx = path.indexOf(cycleStart)
  if (idx === -1) return
  const cycle = normalizeCycle(path.slice(idx))
  const key = cycle.join('\0')
  if (!acc.seenKeys.has(key)) {
    acc.seenKeys.add(key)
    acc.cycles.push(cycle)
  }
}

// â”€â”€â”€ Dead-chain helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function dfsDeadChain(
  deadRoot: string,
  graph: ImportGraph,
  deadFiles: Set<string>,
  reverseGraph: Map<string, Set<string>>,
): string[] {
  const chain: string[] = []
  const visited = new Set<string>()
  const stack = [...(graph.get(deadRoot) ?? [])]
  let node: string | undefined

  while ((node = stack.pop()) !== undefined) {
    if (visited.has(node) || node === deadRoot) continue
    visited.add(node)

    if (deadFiles.has(node) || isOnlyImportedByDead(node, deadFiles, reverseGraph)) {
      chain.push(node)
      for (const next of graph.get(node) ?? []) {
        if (!visited.has(next)) stack.push(next)
      }
    }
  }

  return chain
}

function isOnlyImportedByDead(
  file: string,
  deadFiles: Set<string>,
  reverseGraph: Map<string, Set<string>>,
): boolean {
  const importers = reverseGraph.get(file) ?? new Set<string>()
  return importers.size === 0 || [...importers].every((imp) => deadFiles.has(imp))
}

// â”€â”€â”€ General helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Reverses all edges in the graph. */
function buildReverseGraph(graph: ImportGraph): Map<string, Set<string>> {
  const rev = new Map<string, Set<string>>()

  for (const [file] of graph) {
    if (!rev.has(file)) rev.set(file, new Set())
  }

  for (const [file, imports] of graph) {
    for (const imp of imports) {
      if (!rev.has(imp)) rev.set(imp, new Set())
      rev.get(imp)?.add(file)
    }
  }

  return rev
}

/**
 * Rotates `cycle` so it starts at the lexicographically smallest element,
 * producing a canonical form for deduplication.
 */
function normalizeCycle(cycle: string[]): string[] {
  if (cycle.length === 0) return cycle
  const minIdx = cycle.reduce(
    (best, cur, i) => (cur < cycle[best] ? i : best),
    0,
  )
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)]
}

/** Collects all .ts/.tsx/.js/.jsx files under a directory recursively. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = []
  const SOURCE_RE = /\.(tsx?|jsx?)$/

  function walk(current: string): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && SOURCE_RE.test(entry.name)) {
        results.push(full)
      }
    }
  }

  walk(dir)
  return results
}
