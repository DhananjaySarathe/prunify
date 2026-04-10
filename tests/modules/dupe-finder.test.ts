import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import {
  clusterByName,
  clusterByStructure,
  findDuplicateConstants,
  buildDupeReport,
  type FunctionRecord,
  type DupeCluster,
  type ConstDupe,
} from '@/modules/dupe-finder.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(name: string, bodyHash = 'hash-a', filePath = 'a.ts', line = 1): FunctionRecord {
  return { name, filePath, line, bodyHash, paramCount: 1 }
}

// ─── clusterByName ────────────────────────────────────────────────────────────

describe('clusterByName', () => {
  it('returns no clusters when all names are very different', () => {
    const fns = [makeRecord('alpha'), makeRecord('beta'), makeRecord('gamma')]
    expect(clusterByName(fns)).toHaveLength(0)
  })

  it('clusters functions whose names differ by ≤ 2 characters', () => {
    // "getUser" vs "getUsers" — distance 1
    const fns = [makeRecord('getUser'), makeRecord('getUsers'), makeRecord('fetchOrder')]
    const clusters = clusterByName(fns)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.functions.map((f) => f.name)).toEqual(
      expect.arrayContaining(['getUser', 'getUsers']),
    )
  })

  it('transitively groups a chain of similar names', () => {
    // foo → fo → f  (each pair distance 1 → same cluster)
    const fns = [makeRecord('foo'), makeRecord('fo'), makeRecord('f')]
    const clusters = clusterByName(fns)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.functions).toHaveLength(3)
  })

  it('sets type to "name"', () => {
    const fns = [makeRecord('getUser'), makeRecord('getUsers')]
    expect(clusterByName(fns)[0]!.type).toBe('name')
  })
})

// ─── clusterByStructure ───────────────────────────────────────────────────────

describe('clusterByStructure', () => {
  it('returns no clusters when all hashes differ', () => {
    const fns = [
      makeRecord('foo', 'hash-1'),
      makeRecord('bar', 'hash-2'),
      makeRecord('baz', 'hash-3'),
    ]
    expect(clusterByStructure(fns)).toHaveLength(0)
  })

  it('groups functions with the same bodyHash', () => {
    const fns = [
      makeRecord('foo', 'same-hash', 'a.ts'),
      makeRecord('bar', 'same-hash', 'b.ts'),
      makeRecord('baz', 'diff-hash', 'c.ts'),
    ]
    const clusters = clusterByStructure(fns)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.functions.map((f) => f.name)).toEqual(
      expect.arrayContaining(['foo', 'bar']),
    )
  })

  it('sets type to "structure"', () => {
    const fns = [makeRecord('foo', 'x'), makeRecord('bar', 'x')]
    expect(clusterByStructure(fns)[0]!.type).toBe('structure')
  })

  it('ignores functions with an empty bodyHash', () => {
    const fns = [makeRecord('foo', ''), makeRecord('bar', '')]
    expect(clusterByStructure(fns)).toHaveLength(0)
  })
})

// ─── findDuplicateConstants ───────────────────────────────────────────────────

describe('findDuplicateConstants', () => {
  it('finds constants with the same name and value across files', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile('a.ts', "const BASE_URL = 'https://example.com'")
    project.createSourceFile('b.ts', "const BASE_URL = 'https://example.com'")
    project.createSourceFile('c.ts', "const BASE_URL = 'https://other.com'")

    const liveFiles = new Set(['a.ts', 'b.ts', 'c.ts'])
    const dupes = findDuplicateConstants(project, liveFiles)

    expect(dupes).toHaveLength(1)
    expect(dupes[0]!.name).toBe('BASE_URL')
    expect(dupes[0]!.value).toBe("'https://example.com'")
    expect(dupes[0]!.occurrences).toHaveLength(2)
  })

  it('does not flag constants with the same name but different values', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile('a.ts', 'const LIMIT = 10')
    project.createSourceFile('b.ts', 'const LIMIT = 20')

    const dupes = findDuplicateConstants(project, new Set(['a.ts', 'b.ts']))
    expect(dupes).toHaveLength(0)
  })

  it('returns empty array when there are no consts', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile('a.ts', 'let x = 1')
    const dupes = findDuplicateConstants(project, new Set(['a.ts']))
    expect(dupes).toHaveLength(0)
  })
})

// ─── buildDupeReport ─────────────────────────────────────────────────────────

describe('buildDupeReport', () => {
  const cluster: DupeCluster = {
    type: 'structure',
    functions: [
      makeRecord('foo', 'h', 'src/a.ts', 5),
      makeRecord('bar', 'h', 'src/b.ts', 10),
    ],
  }

  const constDupe: ConstDupe = {
    name: 'API_KEY',
    value: "'abc'",
    occurrences: [
      { filePath: 'src/x.ts', line: 1 },
      { filePath: 'src/y.ts', line: 3 },
    ],
  }

  it('includes a header with counts', () => {
    const report = buildDupeReport([cluster], [constDupe])
    expect(report).toContain('DUPLICATE CODE REPORT')
    expect(report).toContain('Function clusters : 1')
    expect(report).toContain('Const duplicates  : 1')
  })

  it('includes cluster function details', () => {
    const report = buildDupeReport([cluster], [])
    expect(report).toContain('foo')
    expect(report).toContain('bar')
    expect(report).toContain('src/a.ts')
  })

  it('includes duplicate constant details', () => {
    const report = buildDupeReport([], [constDupe])
    expect(report).toContain('API_KEY')
    expect(report).toContain("'abc'")
    expect(report).toContain('src/x.ts')
  })

  it('includes an AI suggestion prompt for each cluster', () => {
    const report = buildDupeReport([cluster], [])
    expect(report).toContain('AI SUGGESTION:')
  })
})
