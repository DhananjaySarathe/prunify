import ora from 'ora'
import chalk from 'chalk'
import Table from 'cli-table3'
import fs from 'node:fs'
import path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import { glob } from '@/utils/file.js'
import { writeMarkdown } from '@/core/reporter.js'

export interface DepCheckOptions {
  cwd: string
  output?: string
}

export interface DepIssue {
  name: string
  type: 'unused' | 'missing' | 'unlisted-dev'
  detail?: string
}

/**
 * Audits package.json against actual import usage in source files.
 */
export async function runDepCheck(opts: DepCheckOptions): Promise<DepIssue[]> {
  const spinner = ora(chalk.cyan('Auditing dependencies…')).start()

  try {
    const pkgPath = path.join(opts.cwd, 'package.json')
    if (!fs.existsSync(pkgPath)) {
      spinner.fail(chalk.red(`No package.json found at ${opts.cwd}`))
      return []
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ])

    const srcDir = path.join(opts.cwd, 'src')
    const files = glob(srcDir, ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'], ['node_modules', 'dist'])

    const usedPackages = new Set<string>()

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8')
      const importRegex = /from\s+['"]([^'"./][^'"]*)['"]/g
      let match: RegExpExecArray | null

      while ((match = importRegex.exec(content)) !== null) {
        const specifier = match[1]
        // Normalise scoped packages: @org/pkg → @org/pkg
        const pkgName = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0]
        usedPackages.add(pkgName)
      }
    }

    const issues: DepIssue[] = []

    // Unused declared dependencies
    for (const dep of declared) {
      if (!usedPackages.has(dep)) {
        issues.push({ name: dep, type: 'unused' })
      }
    }

    // Undeclared (missing) dependencies
    for (const pkg of usedPackages) {
      if (!declared.has(pkg) && !isBuiltin(pkg)) {
        issues.push({ name: pkg, type: 'missing' })
      }
    }

    spinner.succeed(chalk.green(`Dependency audit complete — ${issues.length} issue(s) found`))

    if (issues.length === 0) {
      console.log(chalk.green('  All dependencies look healthy.'))
      return issues
    }

    const table = new Table({ head: ['Package', 'Issue'] })
    for (const issue of issues) {
      const label =
        issue.type === 'unused'
          ? chalk.yellow('unused')
          : issue.type === 'missing'
            ? chalk.red('missing from package.json')
            : chalk.magenta('unlisted dev dep')
      table.push([chalk.gray(issue.name), label])
    }
    console.log(table.toString())

    if (opts.output) {
      writeMarkdown(
        {
          title: 'Dependency Audit Report',
          summary: `${issues.length} dependency issue(s) found`,
          sections: [
            {
              title: 'Issues',
              headers: ['Package', 'Type'],
              rows: issues.map((i) => [i.name, i.type]),
            },
          ],
          generatedAt: new Date(),
        },
        opts.output,
      )
      console.log(chalk.cyan(`  Report written to ${opts.output}`))
    }

    return issues
  } catch (err) {
    spinner.fail(chalk.red('Dependency audit failed'))
    throw err
  }
}

const NODE_BUILTINS = new Set([
  'node:fs', 'node:path', 'node:os', 'node:url', 'node:crypto', 'node:util',
  'node:stream', 'node:events', 'node:child_process', 'node:process',
  'fs', 'path', 'os', 'url', 'crypto', 'util', 'stream', 'events', 'child_process',
])

function isBuiltin(name: string): boolean {
  return NODE_BUILTINS.has(name) || name.startsWith('node:')
}

// ─── Module API ───────────────────────────────────────────────────────────────

export interface DepCheckResult {
  unusedPackages: string[]
  missingPackages: string[]
  report: string
}

/**
 * Packages that live exclusively in config/tooling files and are never
 * imported in application source code. Prunify skips these so it doesn't
 * raise false-positive "unused" warnings.
 */
const CONFIG_ONLY_PACKAGES = new Set([
  // linters / formatters
  'eslint', '@eslint/js', 'eslint-config-prettier', 'eslint-plugin-react',
  'eslint-plugin-import', 'eslint-plugin-node', 'eslint-plugin-jsx-a11y',
  'eslint-plugin-unicorn', '@typescript-eslint/eslint-plugin', '@typescript-eslint/parser',
  'prettier',
  // type-only packages
  // (handled separately via @types/ prefix check)
  // TypeScript & transpilers
  'typescript', 'ts-node', 'tsx',
  // test runners
  'jest', 'ts-jest', '@jest/globals', 'vitest', '@vitest/ui', '@vitest/coverage-v8',
  // bundlers / build tools
  'rollup', 'webpack', 'vite', 'esbuild', 'tsup', 'parcel',
  '@rollup/plugin-node-resolve', '@rollup/plugin-commonjs', '@rollup/plugin-typescript',
  'babel', '@babel/core', '@babel/preset-env', '@babel/preset-typescript',
  // task runners / release
  'nodemon', 'concurrently', 'npm-run-all', 'cross-env', 'rimraf',
  'husky', 'lint-staged', 'commitizen', 'semantic-release',
  // monorepo
  'turbo', 'nx', 'lerna',
  // CSS tooling
  'postcss', 'autoprefixer', 'tailwindcss',
])

/**
 * Synchronous module-level dependency check backed by a pre-built ts-morph
 * `Project`. Flags packages declared in `package.json` that are never
 * imported in any source file (excluding peer deps, `@types/*`, and
 * config-only tooling listed in `CONFIG_ONLY_PACKAGES`).
 */
export function runDepCheckModule(rootDir: string, project: Project): DepCheckResult {
  const pkgPath = path.join(rootDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return { unusedPackages: [], missingPackages: [], report: buildDepReport([], []) }
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }

  // peerDependencies are intentionally excluded — they're provided by the host
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])

  // Collect all package names actually referenced in source
  const usedPackages = new Set<string>()
  for (const sf of project.getSourceFiles()) {
    if (sf.getFilePath().endsWith('.d.ts')) continue

    // Static imports: import { X } from 'pkg'
    for (const importDecl of sf.getImportDeclarations()) {
      const name = extractPackageName(importDecl.getModuleSpecifierValue())
      if (name) usedPackages.add(name)
    }

    // Re-exports: export { X } from 'pkg'
    for (const exportDecl of sf.getExportDeclarations()) {
      const spec = exportDecl.getModuleSpecifierValue()
      if (!spec) continue
      const name = extractPackageName(spec)
      if (name) usedPackages.add(name)
    }

    // Dynamic imports: import('pkg') and require('pkg')
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression().getText()
      if (expr !== 'require' && expr !== 'import') continue
      const args = call.getArguments()
      if (args.length === 0) continue
      const first = args[0]
      if (!first?.isKind(SyntaxKind.StringLiteral)) continue
      const name = extractPackageName(first.getLiteralValue())
      if (name) usedPackages.add(name)
    }
  }

  const unusedPackages: string[] = []
  for (const dep of declared) {
    if (
      !usedPackages.has(dep) &&
      !CONFIG_ONLY_PACKAGES.has(dep) &&
      !dep.startsWith('@types/')
    ) {
      unusedPackages.push(dep)
    }
  }

  const report = buildDepReport(unusedPackages, [])
  return { unusedPackages, missingPackages: [], report }
}

function extractPackageName(specifier: string): string | null {
  if (!specifier) return null
  // Relative / absolute paths are not packages
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null
  // Node builtins
  if (isBuiltin(specifier)) return null
  // Scoped packages: @org/pkg[/sub/path]
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
  }
  // Regular packages: pkg[/sub/path]
  return specifier.split('/')[0]!
}

function buildDepReport(unusedPackages: string[], missingPackages: string[]): string {
  const lines: string[] = [
    '========================================',
    '  DEPENDENCY CHECK',
    `  Unused packages              : ${unusedPackages.length}`,
    `  Missing from package.json    : ${missingPackages.length}`,
    '========================================',
    '',
  ]

  if (unusedPackages.length > 0) {
    lines.push('── UNUSED PACKAGES ──', '')
    for (const pkg of unusedPackages) {
      lines.push(`  ${pkg}`, `  Declared in package.json but never imported in source.`, '')
    }
  }

  if (missingPackages.length > 0) {
    lines.push('── MISSING FROM package.json ──', '')
    for (const pkg of missingPackages) {
      lines.push(`  ${pkg}`, `  Imported in source but not listed in package.json.`, '')
    }
  }

  if (unusedPackages.length === 0 && missingPackages.length === 0) {
    lines.push('  All dependencies look healthy.', '')
  }

  return lines.join('\n')
}
