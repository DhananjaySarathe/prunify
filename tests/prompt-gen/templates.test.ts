import { describe, it, expect } from 'vitest'
import {
  generateDupePrompt,
  generateCircularDepPrompt,
  generateUnusedDepPrompt,
} from '@/prompt-gen/templates.js'

// ─── generateDupePrompt ───────────────────────────────────────────────────────

describe('generateDupePrompt', () => {
  const cluster = {
    type: 'structure' as const,
    functions: [
      { name: 'fetchUser', filePath: 'src/api/users.ts', line: 12, paramCount: 2 },
      { name: 'fetchUser', filePath: 'src/api/admin.ts', line: 7, paramCount: 2 },
    ],
  }

  it('mentions the number of duplicate functions', () => {
    const prompt = generateDupePrompt(cluster, new Map())
    expect(prompt).toContain('2')
  })

  it('labels structurally identical clusters correctly', () => {
    const prompt = generateDupePrompt(cluster, new Map())
    expect(prompt).toContain('structurally identical')
  })

  it('labels similarly-named clusters correctly', () => {
    const nameCluster = { ...cluster, type: 'name' as const }
    expect(generateDupePrompt(nameCluster, new Map())).toContain('similarly-named')
  })

  it('includes file paths and line numbers', () => {
    const prompt = generateDupePrompt(cluster, new Map())
    expect(prompt).toContain('src/api/users.ts:12')
    expect(prompt).toContain('src/api/admin.ts:7')
  })

  it('includes code snippets from the map', () => {
    const snippets = new Map([
      ['src/api/users.ts:12', 'return fetch("/users/" + id)'],
    ])
    const prompt = generateDupePrompt(cluster, snippets)
    expect(prompt).toContain('return fetch("/users/" + id)')
  })

  it('suggests a canonical path derived from the function name', () => {
    const prompt = generateDupePrompt(cluster, new Map())
    expect(prompt).toContain('fetch-user')
  })

  it('asks to show updated import paths', () => {
    const prompt = generateDupePrompt(cluster, new Map())
    expect(prompt.toLowerCase()).toContain('import')
  })
})

// ─── generateCircularDepPrompt ────────────────────────────────────────────────

describe('generateCircularDepPrompt', () => {
  const cycle = ['src/a.ts', 'src/b.ts', 'src/c.ts']

  it('shows the cycle as an arrow chain', () => {
    const prompt = generateCircularDepPrompt(cycle)
    expect(prompt).toContain('src/a.ts → src/b.ts → src/c.ts')
  })

  it('lists each file by index', () => {
    const prompt = generateCircularDepPrompt(cycle)
    expect(prompt).toContain('1. `src/a.ts`')
    expect(prompt).toContain('2. `src/b.ts`')
    expect(prompt).toContain('3. `src/c.ts`')
  })

  it('mentions extracting to a new module', () => {
    const prompt = generateCircularDepPrompt(cycle)
    expect(prompt.toLowerCase()).toContain('extract')
  })

  it('asks for updated import statements', () => {
    const prompt = generateCircularDepPrompt(cycle)
    expect(prompt.toLowerCase()).toContain('import')
  })
})

// ─── generateUnusedDepPrompt ──────────────────────────────────────────────────

describe('generateUnusedDepPrompt', () => {
  const packages = ['lodash', 'moment', 'uuid']

  it('lists each package', () => {
    const prompt = generateUnusedDepPrompt(packages)
    for (const pkg of packages) {
      expect(prompt).toContain(`\`${pkg}\``)
    }
  })

  it('mentions npm uninstall', () => {
    const prompt = generateUnusedDepPrompt(packages)
    expect(prompt).toContain('npm uninstall')
  })

  it('mentions checking peer deps / implicit usage', () => {
    const prompt = generateUnusedDepPrompt(packages)
    expect(prompt.toLowerCase()).toContain('peer')
  })
})
