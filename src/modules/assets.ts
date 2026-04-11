import fs from 'node:fs'
import path from 'node:path'
import ora from 'ora'
import chalk from 'chalk'
import Table from 'cli-table3'
import { glob } from '@/utils/file.js'
import { writeMarkdown, formatBytes } from '@/core/reporter.js'

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

export function buildAssetReport(unused: UnusedAsset[], totalAssets: number, rootDir: string): string {
  const totalBytes = unused.reduce((s, a) => s + a.sizeBytes, 0)
  const usedCount = totalAssets - unused.length
  const pct =
    totalAssets > 0 ? ((unused.length / totalAssets) * 100).toFixed(1) : '0.0'

  const RULE2 = '═'.repeat(78)
  const RULE = '─'.repeat(78)

  const lines: string[] = [
    RULE2,
    '  UNUSED ASSETS REPORT  (public/)',
    RULE2,
    `  Total files scanned : ${totalAssets}`,
    `  Referenced in code  : ${usedCount}`,
    `  Unused (listed)     : ${unused.length}  (${pct}% of scanned)`,
    `  Disk size (unused)  : ${formatBytes(totalBytes)}`,
    RULE2,
    '',
    '  HOW TO READ THIS',
    '',
    '  Files below live under public/ but their filename or public URL path was not',
    '  found in your source scan (TS, JS, CSS, HTML, JSON). They may still be used',
    '  if loaded by URL from a CMS, CDN, or runtime string — verify before deleting.',
    '',
    RULE,
    '',
  ]

  if (unused.length === 0) {
    lines.push(
      '  No unused assets detected — everything scanned appears referenced.',
      '',
      RULE2,
      '  END OF REPORT',
      RULE2,
      '',
      '  If you removed nothing: disk savings = 0 (already optimal for this scan).',
      '',
      RULE2,
      '',
    )
    return lines.join('\n')
  }

  const sorted = [...unused].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, 'en'),
  )

  lines.push('── UNUSED ASSET FILES ──', '', '  Sorted by path.', '')

  for (const asset of sorted) {
    const kb = (asset.sizeBytes / 1024).toFixed(1)
    lines.push(`  • ${asset.relativePath}  (~${kb} KB)`)
    lines.push(`      On disk: ${formatBytes(asset.sizeBytes)}`)
    lines.push('')
  }

  lines.push(
    `  SUBTOTAL — ${sorted.length} file(s) · ${formatBytes(totalBytes)}`,
    '',
    RULE,
    '',
    RULE2,
    '  END OF REPORT — DISK SPACE SUMMARY',
    RULE2,
    '',
    '  If you DELETE every unused asset listed above from public/:',
    '',
    `      Files removed : ${sorted.length}`,
    `      Disk freed    : ${formatBytes(totalBytes)}  (sum of file sizes on disk)`,
    '',
    '  This does not include savings from dead code — see dead-code.txt for source files.',
    '',
    RULE2,
    '',
  )

  return lines.join('\n')
}
