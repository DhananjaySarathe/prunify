import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Project } from 'ts-morph'
import { buildGraph } from '@/core/graph.js'
import { getImportsForFile, buildProject, discoverFiles } from '@/core/parser.js'
import {
  runDeadCodeModule,
  findDeadExports,
  getFileSize,
  buildDeadCodeReport,
} from '@/modules/dead-code.js'

const FIXTURE_DIR = path.resolve('tests/fixtures/dead-code-project')

// ─── getFileSize ──────────────────────────────────────────────────────────────

describe('getFileSize', () => {
  it('returns a positive number for a real file', () => {
    const p = path.join(FIXTURE_DIR, 'src', 'live.ts')
    expect(getFileSize(p)).toBeGreaterThan(0)
  })

  it('returns 0 for a non-existent file', () => {
    expect(getFileSize('/does/not/exist.ts')).toBe(0)
  })
})

// ─── buildDeadCodeReport ──────────────────────────────────────────────────────

describe('buildDeadCodeReport', () => {
  it('includes file counts in the header', () => {
    const report = buildDeadCodeReport(['src/dead.ts'], new Map(), [], '/root')
    expect(report).toContain('Dead files : 1')
    expect(report).toContain('Dead exports: 0')
  })

  it('includes dead file entries', () => {
    const report = buildDeadCodeReport(['/root/src/dead.ts'], new Map(), [], '/root')
    expect(report).toContain('src/dead.ts')
    expect(report).toContain('DEAD FILE')
  })

  it('includes dead export entries', () => {
    const deadExports = [{ filePath: '/root/src/live.ts', exportName: 'orphan', line: 5 }]
    const report = buildDeadCodeReport([], new Map(), deadExports, '/root')
    expect(report).toContain('DEAD EXPORT')
    expect(report).toContain('orphan')
    expect(report).toContain('line 5')
  })
})

// ─── Integration: fixture project ────────────────────────────────────────────

describe('runDeadCodeModule (fixture)', () => {
  it('flags dead.ts and leaves live.ts reachable', () => {
    const files = discoverFiles(FIXTURE_DIR, [])
    const project = buildProject(files)
    const graph = buildGraph(files, (f) => {
      const sf = project.getSourceFile(f)
      return sf ? getImportsForFile(sf) : []
    })

    const indexFile = files.find((f) => f.endsWith('index.ts'))!
    const result = runDeadCodeModule(project, graph, [indexFile], FIXTURE_DIR)

    const relDead = result.deadFiles.map((f) => path.relative(FIXTURE_DIR, f).replace(/\\/g, '/'))
    const relLive = [...result.liveFiles].map((f) => path.relative(FIXTURE_DIR, f).replace(/\\/g, '/'))

    expect(relDead).toContain('src/dead.ts')
    expect(relLive).toContain('src/live.ts')
    expect(relLive).toContain('src/index.ts')
  })

  it('returns a non-empty report string', () => {
    const files = discoverFiles(FIXTURE_DIR, [])
    const project = buildProject(files)
    const graph = buildGraph(files, (f) => {
      const sf = project.getSourceFile(f)
      return sf ? getImportsForFile(sf) : []
    })
    const indexFile = files.find((f) => f.endsWith('index.ts'))!
    const result = runDeadCodeModule(project, graph, [indexFile], FIXTURE_DIR)
    expect(result.report.length).toBeGreaterThan(0)
  })
})

// ─── findDeadExports ──────────────────────────────────────────────────────────

describe('findDeadExports', () => {
  it('finds exports that are never imported by other live files', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile('/src/util.ts', 'export function used() {}\nexport function unused() {}')
    project.createSourceFile('/src/main.ts', "import { used } from './util'")

    const liveFiles = new Set(['/src/util.ts', '/src/main.ts'])
    const dead = findDeadExports(project, liveFiles)

    expect(dead.map((d) => d.exportName)).toContain('unused')
    expect(dead.map((d) => d.exportName)).not.toContain('used')
  })

  it('skips entire files that are namespace-imported', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile('/src/util.ts', 'export function a() {}\nexport function b() {}')
    project.createSourceFile('/src/main.ts', "import * as util from './util'")

    const liveFiles = new Set(['/src/util.ts', '/src/main.ts'])
    const dead = findDeadExports(project, liveFiles)

    // Both exports are covered by namespace import — neither is dead
    expect(dead.filter((d) => d.filePath === '/src/util.ts')).toHaveLength(0)
  })
})
