import { Command } from 'commander'
import chalk from 'chalk'
import Table from 'cli-table3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

// Read version from package.json at runtime so it is always in sync.
// Works in both ESM (import.meta.url defined) and CJS (tsup injects __dirname).
function readPkgVersion(): string {
  try {
    // ESM path
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      const dir = path.dirname(fileURLToPath(import.meta.url))
      const pkgPath = path.resolve(dir, '..', 'package.json')
      return (JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string }).version
    }
  } catch {
    // fall through
  }
  try {
    // CJS path — __dirname is the dist/ folder
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dir: string = (globalThis as any).__dirname ?? __dirname
    const pkgPath = path.resolve(dir, '..', 'package.json')
    return (JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
}

const PKG_VERSION = readPkgVersion()
import { discoverFiles, buildProject, getImportsForFile } from '@/core/parser.js'
import { buildGraph, findEntryPoints, detectCycles, type ImportGraph } from '@/core/graph.js'
import { runDeadCodeModule } from '@/modules/dead-code.js'
import { runDupeFinder } from '@/modules/dupe-finder.js'
import { runDepCheck } from '@/modules/dep-check.js'
import { runHealthReport } from '@/modules/health-report.js'
import { runAssetCheck } from '@/modules/assets.js'
import {
  createSpinner,
  ensureReportsDir,
  appendToGitignore,
  writeReport,
} from '@/core/reporter.js'

// ─── Types ────────────────────────────────────────────────────────────────────

type Module = 'dead-code' | 'dupes' | 'circular' | 'deps' | 'assets' | 'health'

const ALL_MODULES: Module[] = ['dead-code', 'dupes', 'circular', 'deps', 'assets']

interface CliOptions {
  dir: string
  entry?: string
  only?: string
  ignore: string[]
  out?: string
  html?: boolean
  delete?: boolean
  ci?: boolean
}

// ─── CLI definition ───────────────────────────────────────────────────────────

const program = new Command()

program
  .name('prunify')
  .description('npm run clean. ship with confidence.')
  .version(PKG_VERSION, '-v, --version')
  .option('--dir <path>', 'Root directory to analyze', process.cwd())
  .option('--entry <path>', 'Override entry point')
  .option('--only <modules>', 'Comma-separated: dead-code,dupes,circular,deps,health')
  .option(
    '--ignore <pattern>',
    'Glob pattern to ignore (repeatable)',
    (val: string, acc: string[]) => [...acc, val],
    [] as string[],
  )
  .option('--out <path>', 'Output directory for reports')
  .option('--html', 'Also generate code_health.html')
  .option('--delete', 'Prompt to delete dead files after analysis')
  .option('--ci', 'CI mode: exit 1 if issues found, no interactive prompts')
  .action(main)

program.parse()

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(opts: CliOptions): Promise<void> {
  const rootDir = path.resolve(opts.dir)

  if (!fs.existsSync(path.join(rootDir, 'package.json'))) {
    console.error(chalk.red(`✗  No package.json found in ${rootDir}`))
    console.error(chalk.dim('   Use --dir <path> to point to your project root.'))
    process.exit(1)
  }

  const modules = resolveModules(opts.only)

  // Banner
  console.log()
  console.log(chalk.bold.cyan('🧹 prunify — npm run clean. ship with confidence.'))
  console.log()

  // Step 3: Parse codebase
  const parseSpinner = createSpinner(chalk.cyan('Parsing codebase…'))
  const files = discoverFiles(rootDir, opts.ignore)
  parseSpinner.succeed(chalk.green(`Parsed codebase — ${files.length} file(s) found`))

  // Step 4: Build import graph
  const graphSpinner = createSpinner(chalk.cyan('Building import graph…'))
  const project = buildProject(files)
  const graph: ImportGraph = buildGraph(files, (f) => {
    const sf = project.getSourceFile(f)
    return sf ? getImportsForFile(sf) : []
  })
  const edgeCount = [...graph.values()].reduce((n, s) => n + s.size, 0)
  graphSpinner.succeed(chalk.green(`Import graph built — ${edgeCount} edge(s)`))

  const packageJson = loadPackageJson(rootDir)
  const entryPoints = opts.entry ? [path.resolve(opts.entry)] : findEntryPoints(rootDir, packageJson)

  // Set up reports dir
  const reportsDir = ensureReportsDir(rootDir, opts.out)
  appendToGitignore(rootDir)

  console.log()

  // ─── Run modules ─────────────────────────────────────────────────────────

  let deadFileCount = 0
  let dupeCount = 0
  let unusedPkgCount = 0
  let circularCount = 0
  let unusedAssetCount = 0

  let deadReportFile = ''
  let dupesReportFile = ''
  let depsReportFile = ''
  let circularReportFile = ''
  let assetsReportFile = ''

  const deadFilePaths: string[] = []

  if (modules.includes('dead-code')) {
    const spinner = createSpinner(chalk.cyan('Analysing dead code…'))
    const result = runDeadCodeModule(project, graph, entryPoints, rootDir)
    deadFileCount = result.deadFiles.length + result.deadExports.length
    deadFilePaths.push(...result.deadFiles)
    spinner.succeed(chalk.green(`Dead code analysis complete — ${deadFileCount} item(s) found`))

    if (result.report) {
      deadReportFile = 'dead-code.txt'
      writeReport(reportsDir, deadReportFile, result.report)
    }
  }

  if (modules.includes('dupes')) {
    const outputPath = path.join(reportsDir, 'dupes.md')
    const dupes = await runDupeFinder(rootDir, { output: outputPath })
    dupeCount = dupes.length
    if (dupeCount > 0) dupesReportFile = 'dupes.md'
  }

  if (modules.includes('circular')) {
    const spinner = createSpinner(chalk.cyan('Analysing circular imports…'))
    const cycles = detectCycles(graph)
    circularCount = cycles.length
    spinner.succeed(chalk.green(`Circular import analysis complete — ${circularCount} cycle(s) found`))

    if (circularCount > 0) {
      circularReportFile = 'circular.txt'
      const cycleText = cycles
        .map((c, i) => `Cycle ${i + 1}: ${c.join(' → ')}`)
        .join('\n')
      writeReport(reportsDir, circularReportFile, cycleText)
    }
  }

  if (modules.includes('deps')) {
    const outputPath = path.join(reportsDir, 'deps.md')
    const issues = await runDepCheck({ cwd: rootDir, output: outputPath })
    unusedPkgCount = issues.filter((i) => i.type === 'unused').length
    if (issues.length > 0) depsReportFile = 'deps.md'
  }

  if (modules.includes('assets')) {
    const outputPath = path.join(reportsDir, 'assets.md')
    const unusedAssets = await runAssetCheck(rootDir, { output: outputPath })
    unusedAssetCount = unusedAssets.length
    if (unusedAssetCount > 0) assetsReportFile = 'assets.md'
  }

  if (modules.includes('health')) {
    const outputPath = path.join(reportsDir, 'health-report.md')
    await runHealthReport(rootDir, { output: outputPath })
  }

  if (opts.html) {
    const htmlPath = path.join(reportsDir, 'code_health.html')
    writeHtmlReport(htmlPath, rootDir, deadFilePaths, circularCount, dupeCount, unusedPkgCount)
    console.log(chalk.cyan(`  HTML report written to ${htmlPath}`))
  }

  // ─── Summary table ────────────────────────────────────────────────────────

  console.log()
  console.log(chalk.bold('Summary'))
  console.log()

  const table = new Table({
    head: [chalk.bold('Check'), chalk.bold('Found'), chalk.bold('Output File')],
    style: { head: [], border: [] },
  })

  const fmt = (n: number) => (n > 0 ? chalk.yellow(String(n)) : chalk.green('0'))

  table.push(
    ['Dead Files / Exports', fmt(deadFileCount), deadReportFile || '—'],
    ['Duplicate Clusters', fmt(dupeCount), dupesReportFile || '—'],
    ['Unused Packages', fmt(unusedPkgCount), depsReportFile || '—'],
    ['Circular Deps', fmt(circularCount), circularReportFile || '—'],
    ['Unused Assets', fmt(unusedAssetCount), assetsReportFile || '—'],
  )

  console.log(table.toString())
  console.log()

  // ─── --delete ─────────────────────────────────────────────────────────────

  if (opts.delete && deadFilePaths.length > 0) {
    console.log(chalk.yellow(`Dead files (${deadFilePaths.length}):`))
    for (const f of deadFilePaths) {
      console.log(chalk.dim(`  ${path.relative(rootDir, f)}`))
    }
    console.log()

    if (!opts.ci) {
      const confirmed = await confirmPrompt('Delete these files? (y/N) ')
      if (confirmed) {
        for (const f of deadFilePaths) {
          fs.rmSync(f, { force: true })
        }
        console.log(chalk.green(`  Deleted ${deadFilePaths.length} file(s).`))
      } else {
        console.log(chalk.dim('  Skipped.'))
      }
    }
  }

  // ─── --ci ─────────────────────────────────────────────────────────────────

  if (opts.ci) {
    const hasIssues = deadFileCount > 0 || dupeCount > 0 || unusedPkgCount > 0 || circularCount > 0 || unusedAssetCount > 0
    if (hasIssues) process.exit(1)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveModules(only: string | undefined): Module[] {
  if (!only) return ALL_MODULES
  const valid = new Set<Module>([...ALL_MODULES, 'health'])
  return only
    .split(',')
    .map((s) => s.trim() as Module)
    .filter((m) => valid.has(m))
}

function loadPackageJson(dir: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
  } catch {
    return null
  }
}

function confirmPrompt(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

function writeHtmlReport(
  outputPath: string,
  rootDir: string,
  deadFiles: string[],
  circularCount: number,
  dupeCount: number,
  unusedPkgCount: number,
): void {
  const rows = [
    ['Dead Files / Exports', String(deadFiles.length)],
    ['Duplicate Clusters', String(dupeCount)],
    ['Circular Dependencies', String(circularCount)],
    ['Unused Packages', String(unusedPkgCount)],
  ]
    .map(([label, val]) => `    <tr><td>${label}</td><td>${val}</td></tr>`)
    .join('\n')

  const deadList =
    deadFiles.length > 0
      ? `<ul>${deadFiles.map((f) => `<li>${path.relative(rootDir, f)}</li>`).join('')}</ul>`
      : '<p>None</p>'

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>prunify — Code Health Report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #0ea5e9; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
    th, td { border: 1px solid #e2e8f0; padding: .5rem 1rem; text-align: left; }
    th { background: #f8fafc; }
    small { color: #94a3b8; }
  </style>
</head>
<body>
  <h1>🧹 prunify — Code Health Report</h1>
  <small>Generated ${new Date().toISOString()}</small>
  <h2>Summary</h2>
  <table>
    <tr><th>Check</th><th>Found</th></tr>
${rows}
  </table>
  <h2>Dead Files</h2>
  ${deadList}
</body>
</html>`

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, html, 'utf-8')
}

