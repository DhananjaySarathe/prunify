import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  buildGraph,
  runDFS,
  findDeadChains,
  detectCycles,
  isConventionRoutedSourceFile,
} from '@/core/graph.js'

// ─── isConventionRoutedSourceFile ─────────────────────────────────────────────

describe('isConventionRoutedSourceFile', () => {
  const root = path.resolve('/repo')

  it('treats src/pages as routed', () => {
    expect(isConventionRoutedSourceFile(path.join(root, 'src/pages/index.tsx'), root)).toBe(true)
  })

  it('treats top-level pages as routed', () => {
    expect(isConventionRoutedSourceFile(path.join(root, 'pages/_app.tsx'), root)).toBe(true)
  })

  it('treats app/page.tsx as routed', () => {
    expect(isConventionRoutedSourceFile(path.join(root, 'src/app/dashboard/page.tsx'), root)).toBe(
      true,
    )
  })

  it('does not treat arbitrary modules under src/app as routed', () => {
    expect(isConventionRoutedSourceFile(path.join(root, 'src/app/lib/helpers.ts'), root)).toBe(
      false,
    )
  })

  it('does not treat normal src files as routed', () => {
    expect(isConventionRoutedSourceFile(path.join(root, 'src/components/Button.tsx'), root)).toBe(
      false,
    )
  })
})

// ─── buildGraph ───────────────────────────────────────────────────────────────

describe('buildGraph', () => {
  it('creates a node for every file', () => {
    const graph = buildGraph(['a', 'b', 'c'], () => [])
    expect([...graph.keys()]).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })

  it('records edges from getImports', () => {
    const graph = buildGraph(['a', 'b', 'c'], (f) => (f === 'a' ? ['b'] : []))
    expect(graph.get('a')).toContain('b')
    expect(graph.get('b')?.size).toBe(0)
  })

  it('adds an implicit node for an import not in the file list', () => {
    const graph = buildGraph(['a'], () => ['external'])
    expect(graph.has('external')).toBe(true)
  })
})

// ─── runDFS ───────────────────────────────────────────────────────────────────

describe('runDFS', () => {
  it('returns only reachable nodes from the entry point', () => {
    const graph = buildGraph(['a', 'b', 'c'], (f) => {
      if (f === 'a') return ['b']
      return []
    })
    const live = runDFS(graph, ['a'])
    expect(live.has('a')).toBe(true)
    expect(live.has('b')).toBe(true)
    expect(live.has('c')).toBe(false)
  })

  it('handles multiple entry points', () => {
    const graph = buildGraph(['a', 'b', 'c', 'd'], (f) => {
      if (f === 'a') return ['b']
      if (f === 'c') return ['d']
      return []
    })
    const live = runDFS(graph, ['a', 'c'])
    expect(live.has('b')).toBe(true)
    expect(live.has('d')).toBe(true)
  })

  it('is safe against cycles', () => {
    const graph = buildGraph(['a', 'b'], (f) => (f === 'a' ? ['b'] : ['a']))
    expect(() => runDFS(graph, ['a'])).not.toThrow()
    const live = runDFS(graph, ['a'])
    expect(live.has('a')).toBe(true)
    expect(live.has('b')).toBe(true)
  })
})

// ─── findDeadChains ───────────────────────────────────────────────────────────

describe('findDeadChains', () => {
  it('returns an empty chain for a dead root with no dead imports', () => {
    const graph = buildGraph(['entry', 'dead'], () => [])
    const deadSet = new Set(['dead'])
    const chains = findDeadChains(graph, deadSet)
    expect(chains.get('dead')).toEqual([])
  })

  it('includes transitively dead files in the chain', () => {
    // dead → also-dead; entry never imports either
    const graph = buildGraph(['entry', 'dead', 'also-dead'], (f) => {
      if (f === 'dead') return ['also-dead']
      return []
    })
    const deadSet = new Set(['dead', 'also-dead'])
    const chains = findDeadChains(graph, deadSet)
    expect(chains.get('dead')).toContain('also-dead')
  })
})

// ─── detectCycles ─────────────────────────────────────────────────────────────

describe('detectCycles', () => {
  it('returns empty array for an acyclic graph', () => {
    const graph = buildGraph(['a', 'b', 'c'], (f) => {
      if (f === 'a') return ['b']
      if (f === 'b') return ['c']
      return []
    })
    expect(detectCycles(graph)).toHaveLength(0)
  })

  it('detects a simple 2-node cycle', () => {
    const graph = buildGraph(['a', 'b'], (f) => (f === 'a' ? ['b'] : ['a']))
    const cycles = detectCycles(graph)
    expect(cycles.length).toBeGreaterThan(0)
    const flat = cycles.flat()
    expect(flat).toContain('a')
    expect(flat).toContain('b')
  })

  it('detects a 3-node cycle', () => {
    const graph = buildGraph(['a', 'b', 'c'], (f) => {
      if (f === 'a') return ['b']
      if (f === 'b') return ['c']
      if (f === 'c') return ['a']
      return []
    })
    const cycles = detectCycles(graph)
    expect(cycles.length).toBeGreaterThan(0)
  })

  it('deduplicates rotations of the same cycle', () => {
    const graph = buildGraph(['a', 'b', 'c'], (f) => {
      if (f === 'a') return ['b']
      if (f === 'b') return ['c']
      if (f === 'c') return ['a']
      return []
    })
    // All rotations of a→b→c are the same cycle; should only appear once
    expect(detectCycles(graph)).toHaveLength(1)
  })
})
