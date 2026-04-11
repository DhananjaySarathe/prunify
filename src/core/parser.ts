import fs from 'node:fs'
import path from 'node:path'
import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph'
import { glob } from '@/utils/file.js'

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ParsedFile {
  path: string
  sourceFile: SourceFile
  exports: string[]
  imports: ImportEntry[]
}

export interface ImportEntry {
  moduleSpecifier: string
  namedImports: string[]
  defaultImport: string | undefined
  isTypeOnly: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_IGNORE = [
  'node_modules',
  'node_modules/**',
  'dist',
  'dist/**',
  '.next',
  '.next/**',
  'coverage',
  'coverage/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.js',
  '**/*.test.jsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.spec.js',
  '**/*.spec.jsx',
  '**/*.stories.ts',
  '**/*.stories.tsx',
  '**/*.d.ts',
]

const SOURCE_PATTERNS = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']

const RESOLVE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
] as const

const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'] as const

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Recursively discovers all .ts/.tsx/.js/.jsx files under `rootDir`.
 *
 * Default exclusions: node_modules, dist, .next, coverage,
 * *.test.ts, *.spec.ts, *.stories.tsx, *.d.ts
 *
 * Additional glob-style patterns can be passed via `ignore`.
 */
export function discoverFiles(rootDir: string, ignore: string[] = []): string[] {
  return glob(rootDir, SOURCE_PATTERNS, [...DEFAULT_IGNORE, ...ignore])
}

/**
 * Creates a ts-morph Project loaded with the given source files.
 *
 * If `tsconfigPath` is not provided, the function walks up the directory tree
 * from the first file in the list to locate a `tsconfig.json`. When found, the
 * project is initialised with it so that path aliases are resolved correctly.
 */
export function buildProject(files: string[], tsconfigPath?: string): Project {
  const resolved = tsconfigPath ?? (files.length > 0 ? findTsconfig(files[0]) : undefined)

  const project = resolved
    ? new Project({ tsConfigFilePath: resolved, skipAddingFilesFromTsConfig: true })
    : new Project({
        compilerOptions: {
          allowJs: true,
          resolveJsonModule: true,
        },
      })

  project.addSourceFilesAtPaths(files)
  return project
}

/**
 * Returns the resolved absolute file paths of every local module imported by
 * `sourceFile`.
 *
 * Handles:
 *  - Named imports:          `import { X } from './foo'`
 *  - Default imports:        `import Foo from './foo'`
 *  - Namespace imports:      `import * as Foo from './foo'`
 *  - Re-exports:             `export { X } from './foo'`
 *  - Dynamic imports:        `const m = await import('./foo')`
 *  - Index resolution:       `import './components'` → `./components/index.ts`
 *  - Path aliases:           `import '@/utils/foo'` (via tsconfig paths)
 *  - node_modules filtered:  bare specifiers like `'chalk'` are excluded
 */
export function getImportsForFile(sourceFile: SourceFile): string[] {
  const result = new Set<string>()
  const fileDir = path.dirname(sourceFile.getFilePath())
  const project = sourceFile.getProject()
  const compilerOptions = project.getCompilerOptions()
  const pathAliases = (compilerOptions.paths ?? {}) as Record<string, string[]>
  const baseUrl = compilerOptions.baseUrl

  function addResolved(sf: SourceFile | undefined): void {
    if (!sf) return
    const p = path.normalize(sf.getFilePath())
    if (
      !p.includes(`${path.sep}node_modules${path.sep}`) &&
      !p.includes('/node_modules/') &&
      path.normalize(sourceFile.getFilePath()) !== p
    ) {
      result.add(p)
    }
  }

  function resolveAndAdd(specifier: string): void {
    if (!specifier) return
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../')

    if (isRelative) {
      const p = resolveRelativePath(fileDir, specifier, project)
      if (p) result.add(p)
    } else if (!specifier.startsWith('node:')) {
      const p = resolvePathAlias(specifier, pathAliases, baseUrl, project)
      if (p) result.add(p)
    }
  }

  // 1. Static import declarations
  for (const decl of sourceFile.getImportDeclarations()) {
    const sf = decl.getModuleSpecifierSourceFile()
    sf ? addResolved(sf) : resolveAndAdd(decl.getModuleSpecifierValue())
  }

  // 2. Re-export declarations: export { X } from '...'
  for (const decl of sourceFile.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue()
    if (!specifier) continue
    const sf = decl.getModuleSpecifierSourceFile()
    sf ? addResolved(sf) : resolveAndAdd(specifier)
  }

  // 3. Dynamic imports: import('...')
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue
    const args = call.getArguments()
    if (args.length > 0 && Node.isStringLiteral(args[0])) {
      resolveAndAdd(args[0].getLiteralValue())
    }
  }

  return [...result]
}

// ─── Legacy helpers (used by other modules) ───────────────────────────────────

export function createProject(dir: string): Project {
  const files = glob(dir, SOURCE_PATTERNS, [
    'node_modules',
    'node_modules/**',
    'dist',
    'dist/**',
    '**/*.d.ts',
  ])
  return buildProject(files)
}

export function parseFile(sourceFile: SourceFile): ParsedFile {
  const exports: string[] = []
  const imports: ImportEntry[] = []

  for (const exportDecl of sourceFile.getExportDeclarations()) {
    if (exportDecl.isTypeOnly()) continue
    for (const named of exportDecl.getNamedExports()) {
      exports.push(named.getName())
    }
  }

  for (const exportSymbol of sourceFile.getExportedDeclarations()) {
    exports.push(exportSymbol[0])
  }

  for (const importDecl of sourceFile.getImportDeclarations()) {
    imports.push({
      moduleSpecifier: importDecl.getModuleSpecifierValue(),
      namedImports: importDecl.getNamedImports().map((n) => n.getName()),
      defaultImport: importDecl.getDefaultImport()?.getText(),
      isTypeOnly: importDecl.isTypeOnly(),
    })
  }

  return {
    path: sourceFile.getFilePath(),
    sourceFile,
    exports: [...new Set(exports)],
    imports,
  }
}

export function parseProject(dir: string): Map<string, ParsedFile> {
  const project = createProject(dir)
  const result = new Map<string, ParsedFile>()
  for (const sourceFile of project.getSourceFiles()) {
    const parsed = parseFile(sourceFile)
    result.set(parsed.path, parsed)
  }
  return result
}

export function isNodeReferenced(node: Node, sourceFile: SourceFile): boolean {
  if (!Node.isReferenceFindable(node)) return false
  return node
    .findReferences()
    .some((ref) =>
      ref
        .getReferences()
        .some((r) => r.getSourceFile().getFilePath() !== sourceFile.getFilePath()),
    )
}

// ─── Internal resolution helpers ─────────────────────────────────────────────

/**
 * Resolves a relative specifier (e.g. `'./utils'`) from `fromDir` to an
 * absolute path that exists inside the project, trying all source extensions
 * and index file variants.
 */
function resolveRelativePath(
  fromDir: string,
  specifier: string,
  project: Project,
): string | null {
  const base = path.resolve(fromDir, specifier)

  for (const ext of RESOLVE_EXTENSIONS) {
    const sf = project.getSourceFile(base + ext)
    if (sf) return path.normalize(sf.getFilePath())
  }

  for (const index of INDEX_FILES) {
    const sf = project.getSourceFile(path.join(base, index))
    if (sf) return path.normalize(sf.getFilePath())
  }

  return null
}

/**
 * Resolves a path-alias specifier (e.g. `'@/utils/file'`) using the
 * `paths` map from tsconfig. Returns the absolute file path or null.
 */
function resolvePathAlias(
  specifier: string,
  pathAliases: Record<string, string[]>,
  baseUrl: string | undefined,
  project: Project,
): string | null {
  for (const [alias, targets] of Object.entries(pathAliases)) {
    const match = matchAlias(alias, specifier)
    if (!match) continue

    const capture = match[1] ?? ''

    for (const target of targets) {
      const resolved = target.replaceAll('*', capture)
      const absolute = baseUrl ? path.resolve(baseUrl, resolved) : path.resolve(resolved)
      const hit = tryResolveAbsolute(absolute, project)
      if (hit) return hit
    }
  }

  return null
}

/** Converts an alias pattern (e.g. `@/*`) to a RegExp and tests `specifier`. */
function matchAlias(alias: string, specifier: string): RegExpExecArray | null {
  // Escape all regex metacharacters except `*`, then replace `*` with a capture group.
  const escaped = alias.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped.replaceAll('*', '(.*)')
  return new RegExp(`^${pattern}$`).exec(specifier)
}

/** Tries all source extensions and index file variants for an absolute base path. */
function tryResolveAbsolute(absolute: string, project: Project): string | null {
  for (const ext of RESOLVE_EXTENSIONS) {
    const sf = project.getSourceFile(absolute + ext)
    if (sf) return path.normalize(sf.getFilePath())
  }
  for (const index of INDEX_FILES) {
    const sf = project.getSourceFile(path.join(absolute, index))
    if (sf) return path.normalize(sf.getFilePath())
  }
  return null
}

/**
 * Walks up the directory tree from `fromFile` to find the nearest
 * `tsconfig.json`.
 */
function findTsconfig(fromFile: string): string | undefined {
  let dir = path.dirname(fromFile)
  const root = path.parse(dir).root

  while (dir !== root) {
    const candidate = path.join(dir, 'tsconfig.json')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return undefined
}
