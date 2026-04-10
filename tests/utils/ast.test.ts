import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import {
  hashFunctionBody,
  getTopLevelDeclarations,
  hasInternalTag,
  isExported,
  getDeclarationName,
} from '@/utils/ast.js'

function makeProject(code: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
  return sf
}

// ─── hashFunctionBody ─────────────────────────────────────────────────────────

describe('hashFunctionBody', () => {
  it('returns a non-empty string', () => {
    const sf = makeProject('function foo(x: number) { return x + 1 }')
    const fn = sf.getFunctions()[0]!
    expect(hashFunctionBody(fn).length).toBeGreaterThan(0)
  })

  it('produces the same hash for structurally identical functions', () => {
    const sf = makeProject(`
      function foo(x: number) { return x + 1 }
      function bar(y: number) { return y + 1 }
    `)
    const [foo, bar] = sf.getFunctions()
    expect(hashFunctionBody(foo!)).toBe(hashFunctionBody(bar!))
  })

  it('produces different hashes for structurally different functions', () => {
    const sf = makeProject(`
      function foo(x: number) { return x + 1 }
      function bar(x: number) { return x * 2 }
    `)
    const [foo, bar] = sf.getFunctions()
    expect(hashFunctionBody(foo!)).not.toBe(hashFunctionBody(bar!))
  })

  it('works on arrow functions', () => {
    const sf = makeProject('const fn = (x: number) => x + 1')
    const decl = sf.getVariableDeclarations()[0]!
    const arrow = decl.getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction)
    expect(hashFunctionBody(arrow).length).toBeGreaterThan(0)
  })
})

// ─── getTopLevelDeclarations ──────────────────────────────────────────────────

describe('getTopLevelDeclarations', () => {
  it('returns function declarations', () => {
    const sf = makeProject('function greet() {}')
    const decls = getTopLevelDeclarations(sf)
    expect(decls.some((d) => 'getName' in d && d.getName() === 'greet')).toBe(true)
  })

  it('returns variable declarations', () => {
    const sf = makeProject('const x = 42')
    const decls = getTopLevelDeclarations(sf)
    expect(decls.some((d) => 'getName' in d && d.getName() === 'x')).toBe(true)
  })

  it('returns class declarations', () => {
    const sf = makeProject('class Foo {}')
    const decls = getTopLevelDeclarations(sf)
    expect(decls.some((d) => 'getName' in d && d.getName() === 'Foo')).toBe(true)
  })

  it('returns interface declarations', () => {
    const sf = makeProject('interface Bar {}')
    const decls = getTopLevelDeclarations(sf)
    expect(decls.some((d) => 'getName' in d && d.getName() === 'Bar')).toBe(true)
  })
})

// ─── hasInternalTag ───────────────────────────────────────────────────────────

describe('hasInternalTag', () => {
  it('returns true for @internal JSDoc', () => {
    const sf = makeProject('/** @internal */\nexport function secret() {}')
    const fn = sf.getFunctions()[0]!
    expect(hasInternalTag(fn)).toBe(true)
  })

  it('returns false for functions without @internal', () => {
    const sf = makeProject('export function pub() {}')
    const fn = sf.getFunctions()[0]!
    expect(hasInternalTag(fn)).toBe(false)
  })
})

// ─── isExported ───────────────────────────────────────────────────────────────

describe('isExported', () => {
  it('returns true for exported declarations', () => {
    const sf = makeProject('export function foo() {}')
    const fn = sf.getFunctions()[0]!
    expect(isExported(fn)).toBe(true)
  })

  it('returns false for non-exported declarations', () => {
    const sf = makeProject('function foo() {}')
    const fn = sf.getFunctions()[0]!
    expect(isExported(fn)).toBe(false)
  })
})

// ─── getDeclarationName ───────────────────────────────────────────────────────

describe('getDeclarationName', () => {
  it('returns the name of a function declaration', () => {
    const sf = makeProject('function myFunc() {}')
    const fn = sf.getFunctions()[0]!
    expect(getDeclarationName(fn)).toBe('myFunc')
  })

  it('returns the name of a variable declaration', () => {
    const sf = makeProject('const myVar = 1')
    const decl = sf.getVariableDeclarations()[0]!
    expect(getDeclarationName(decl)).toBe('myVar')
  })
})
