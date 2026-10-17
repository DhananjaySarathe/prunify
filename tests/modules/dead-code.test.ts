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
    const report = buildDeadCodeReport(['src/dead.ts'], [], new Map(), [], '/root')
    expect(report).toContain('Safe to delete     : 1')
    expect(report).toContain('Dead exports       : 0')
  })

  it('includes dead file entries', () => {
    const report = buildDeadCodeReport(['/root/src/dead.ts'], [], new Map(), [], '/root')
    expect(report).toContain('src/dead.ts')
    expect(report).toContain('SAFE TO DELETE')
  })

  it('includes dead export entries', () => {
    const deadExports = [{ filePath: '/root/src/live.ts', exportName: 'orphan', line: 5 }]
    const report = buildDeadCodeReport([], [], new Map(), deadExports, '/root')
    expect(report).toContain('DEAD EXPORTS')
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

  it('keeps exports used through import() and aliased imports, and still flags the rest', () => {
    const dir = path.resolve('tests/fixtures/dynamic-import-project')
    const files = discoverFiles(dir, [])
    const project = buildProject(files)
    const graph = buildGraph(files, (f) => {
      const sf = project.getSourceFile(f)
      return sf ? getImportsForFile(sf) : []
    })

    const indexFile = files.find((f) => f.endsWith('index.ts'))!
    const result = runDeadCodeModule(project, graph, [indexFile], dir)

    const rel = (f: string) => path.relative(dir, f).replace(/\\/g, '/')
    expect(result.deadFiles).toEqual([])
    expect(result.deadExports.map((e) => `${rel(e.filePath)}#${e.exportName}`).sort()).toEqual([
      'src/aliased.ts#unusedAliasTarget',
      'src/destructured.ts#unusedDestructured',
      'src/picked.ts#unusedPicked',
    ])
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
    const dead = findDeadExports(project, liveFiles, '/')

    expect(dead.map((d) => d.exportName)).toContain('unused')
    expect(dead.map((d) => d.exportName)).not.toContain('used')
  })

  it('skips entire files that are namespace-imported', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile('/src/util.ts', 'export function a() {}\nexport function b() {}')
    project.createSourceFile('/src/main.ts', "import * as util from './util'")

    const liveFiles = new Set(['/src/util.ts', '/src/main.ts'])
    const dead = findDeadExports(project, liveFiles, '/')

    // Both exports are covered by namespace import — neither is dead
    expect(dead.filter((d) => d.filePath === '/src/util.ts')).toHaveLength(0)
  })

  it('does not flag exports in Next.js pages as dead', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile(
      '/proj/src/pages/about.tsx',
      'export default function Page() { return null }\nexport const x = 1\n',
    )
    project.createSourceFile('/proj/src/lib/ok.ts', "export const y = 1\n")

    const liveFiles = new Set(['/proj/src/pages/about.tsx', '/proj/src/lib/ok.ts'])
    const dead = findDeadExports(project, liveFiles, '/proj')

    expect(dead.filter((d) => d.filePath.includes('pages'))).toHaveLength(0)
  })
})

// ─── findDeadExports: dynamic import() and aliased imports ───────────────────

/** Dead export names in /src/util.ts when /src/main.ts is the only other live file. */
function deadInUtil(util: string, main: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true })
  project.createSourceFile('/src/util.ts', util)
  project.createSourceFile('/src/main.ts', main)

  const dead = findDeadExports(project, new Set(['/src/util.ts', '/src/main.ts']), '/')
  return dead
    .filter((d) => d.filePath === '/src/util.ts')
    .map((d) => d.exportName)
    .sort()
}

describe('findDeadExports with dynamic import()', () => {
  const UTIL = 'export function used() {}\nexport function unused() {}\n'

  it('counts every export as used when the module itself is handed on (React.lazy, next/dynamic)', () => {
    expect(deadInUtil(UTIL, "export const Lazy = lazy(() => import('./util'))\n")).toEqual([])
    expect(deadInUtil(UTIL, "export const loader = import('./util')\n")).toEqual([])
  })

  it('reads the export picked in a .then() callback', () => {
    expect(
      deadInUtil(UTIL, "export const Palette = dynamic(() => import('./util').then((mod) => mod.used))\n"),
    ).toEqual(['unused'])
    expect(deadInUtil(UTIL, "import('./util').then(function (m) { return m['used'] })\n")).toEqual(['unused'])
  })

  it('reads exports destructured in a .then() callback', () => {
    expect(deadInUtil(UTIL, "import('./util').then(({ used: run }) => run())\n")).toEqual(['unused'])
  })

  it('reads exports destructured from an awaited import', () => {
    expect(deadInUtil(UTIL, "const { used } = await import('./util')\nused()\n")).toEqual(['unused'])
  })

  it('reads a property taken straight off an awaited import', () => {
    expect(deadInUtil(UTIL, "(await import('./util')).used()\n")).toEqual(['unused'])
    expect(deadInUtil(UTIL, "export {}\nawait (await import('./util'))['used']()\n")).toEqual(['unused'])
  })

  it('reads properties used on a variable that holds the module', () => {
    expect(deadInUtil(UTIL, "const util = await import('./util')\nutil.used()\n")).toEqual(['unused'])
  })

  it('counts every export as used when it cannot tell which ones are read', () => {
    expect(deadInUtil(UTIL, "const util = await import('./util')\nconsole.log(util)\n")).toEqual([])
    expect(deadInUtil(UTIL, "import('./util').then(register)\n")).toEqual([])
    expect(deadInUtil(UTIL, "import('./util').then(({ ...all }) => all)\n")).toEqual([])
    expect(deadInUtil(UTIL, "import('./util').then((m) => Object.keys(m))\n")).toEqual([])
  })

  it('ignores import() of packages and unresolvable paths', () => {
    expect(deadInUtil(UTIL, "import('chalk')\nimport('./missing')\n")).toEqual(['unused', 'used'])
  })
})

describe('findDeadExports with aliased imports', () => {
  it('records the exported name, not the local alias', () => {
    const util = 'export function used() {}\nexport function unused() {}\n'
    expect(deadInUtil(util, "import { used as renamed } from './util'\nrenamed()\n")).toEqual(['unused'])
  })

  it('treats `default as X` as a use of the default export', () => {
    const util = 'export default function main() {}\nexport const other = 1\n'
    expect(deadInUtil(util, "import { default as main } from './util'\nmain()\n")).toEqual(['other'])
  })
})
