import fs from 'node:fs'
import path from 'node:path'
import ora from 'ora'
import chalk from 'chalk'
import Table from 'cli-table3'
import { glob } from '@/utils/file.js'
import { writeMarkdown } from '@/core/reporter.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UnusedAsset {
  filePath: string
  relativePath: string
  sizeBytes: number
}

export interface AssetCheckResult {
  unusedAssets: UnusedAsset[]
  totalAssets: number
  report: string
}

export interface AssetCheckOptions {
  output?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav',
  '.pdf',
])

const SOURCE_PATTERNS = [
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
  '**/*.css', '**/*.scss', '**/*.sass', '**/*.less',
  '**/*.html', '**/*.json',
]

const SOURCE_IGNORE = [
  'node_modules', 'node_modules/**',
  'dist', 'dist/**',
  '.next', '.next/**',
  'coverage', 'coverage/**',
  'public', 'public/**',
]

// ─── Public module API ────────────────────────────────────────────────────────

/**
 * Scans `public/` for assets and checks whether each filename appears in
 * any source file (TS/JS/CSS/HTML/JSON). Checks both the bare filename and
 * the public-root-relative path (e.g. `/logo.png`).
 */
export function runAssetCheckModule(rootDir: string): AssetCheckResult {
  const publicDir = path.join(rootDir, 'public')

  if (!fs.existsSync(publicDir)) {
    return { unusedAssets: [], totalAssets: 0, report: buildAssetReport([], 0, rootDir) }
  }

  const assets = collectAssets(publicDir)
  if (assets.length === 0) {
    return { unusedAssets: [], totalAssets: 0, report: buildAssetReport([], 0, rootDir) }
  }

  // Read all source content once
  const sourceFiles = glob(rootDir, SOURCE_PATTERNS, SOURCE_IGNORE)
  const sourceContent = sourceFiles.reduce((acc, f) => {
    try { return acc + fs.readFileSync(f, 'utf-8') + '\n' } catch { return acc }
  }, '')

  const unused: UnusedAsset[] = []

  for (const assetAbs of assets) {
    const fileName = path.basename(assetAbs)
    // Public-root-relative path e.g. "/images/logo.png"
    const relFromPublic = '/' + path.relative(publicDir, assetAbs).replaceAll('\\', '/')

    const referenced =
      sourceContent.includes(fileName) ||
      sourceContent.includes(relFromPublic)

    if (!referenced) {
      unused.push({
        filePath: assetAbs,
        relativePath: path.relative(rootDir, assetAbs).replaceAll('\\', '/'),
        sizeBytes: getFileSize(assetAbs),
      })
    }
  }

  const report = buildAssetReport(unused, assets.length, rootDir)
  return { unusedAssets: unused, totalAssets: assets.length, report }
}

// ─── CLI command ──────────────────────────────────────────────────────────────

export async function runAssetCheck(rootDir: string, opts: AssetCheckOptions): Promise<UnusedAsset[]> {
  const publicDir = path.join(rootDir, 'public')

  if (!fs.existsSync(publicDir)) {
    console.log(chalk.dim('  No public/ folder found — skipping asset check'))
    return []
  }

  const spinner = ora(chalk.cyan('Scanning public/ for unused assets…')).start()

  try {
    const result = runAssetCheckModule(rootDir)

    spinner.succeed(
      chalk.green(
        `Asset scan complete — ${result.unusedAssets.length} unused / ${result.totalAssets} total`,
      ),
    )

    if (result.unusedAssets.length === 0) {
      console.log(chalk.green('  All public assets are referenced in source.'))
      return []
    }

    const table = new Table({ head: ['Asset', 'Size'] })
    for (const asset of result.unusedAssets) {
      const kb = (asset.sizeBytes / 1024).toFixed(1)
      table.push([chalk.gray(asset.relativePath), `${kb} KB`])
    }
    console.log(table.toString())

    if (opts.output) {
      writeMarkdown(
        {
          title: 'Unused Assets Report',
          summary: `${result.unusedAssets.length} unused asset(s) found in public/`,
          sections: [
            {
              title: 'Unused Assets',
              headers: ['Asset', 'Size (KB)'],
              rows: result.unusedAssets.map((a) => [
                a.relativePath,
                (a.sizeBytes / 1024).toFixed(1),
              ]),
            },
          ],
          generatedAt: new Date(),
        },
        opts.output,
      )
      console.log(chalk.cyan(`  Report written to ${opts.output}`))
    }

    return result.unusedAssets
  } catch (err) {
    spinner.fail(chalk.red('Asset scan failed'))
    throw err
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function collectAssets(dir: string): string[] {
  const results: string[] = []

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
      } else if (entry.isFile() && ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(full)
      }
    }
  }

  walk(dir)
  return results
}

function getFileSize(filePath: string): number {
  try { return fs.statSync(filePath).size } catch { return 0 }
}

function buildAssetReport(unused: UnusedAsset[], totalAssets: number, rootDir: string): string {
  const totalBytes = unused.reduce((s, a) => s + a.sizeBytes, 0)
  const totalKb = (totalBytes / 1024).toFixed(1)

  const lines: string[] = [
    '========================================',
    '  UNUSED ASSETS REPORT',
    `  Total assets   : ${totalAssets}`,
    `  Unused assets  : ${unused.length}`,
    `  Recoverable    : ~${totalKb} KB`,
    '========================================',
    '',
  ]

  if (unused.length === 0) {
    lines.push('  All public assets are referenced in source.', '')
    return lines.join('\n')
  }

  lines.push('── UNUSED ASSETS ──', '')
  for (const asset of unused) {
    lines.push(
      `UNUSED — ${asset.relativePath}`,
      `Size: ~${(asset.sizeBytes / 1024).toFixed(1)} KB`,
      `Action: Safe to delete if not served directly via URL`,
      '',
    )
  }

  return lines.join('\n')
}
