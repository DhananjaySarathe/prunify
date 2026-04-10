import fs from 'node:fs'
import path from 'node:path'
import ora, { type Ora } from 'ora'

// ─── Spinner ──────────────────────────────────────────────────────────────────

export type Spinner = Ora

/**
 * Creates an ora spinner and starts it immediately.
 */
export function createSpinner(text: string): Spinner {
  return ora(text).start()
}

// ─── Reports dir ─────────────────────────────────────────────────────────────

const REPORTS_DIR_NAME = 'prunify-reports'

/**
 * Creates (if needed) a `prunify-reports/` folder inside `outDir ?? rootDir`
 * and returns its absolute path.
 */
export function ensureReportsDir(rootDir: string, outDir?: string): string {
  const base = outDir ? path.resolve(outDir) : path.resolve(rootDir)
  const reportsDir = path.join(base, REPORTS_DIR_NAME)
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true })
  }
  return reportsDir
}

/**
 * Writes `content` to `reportsDir/filename` and logs the path.
 */
export function writeReport(reportsDir: string, filename: string, content: string): void {
  ensureDir(reportsDir)
  const filePath = path.join(reportsDir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`  Report saved → ${filePath}`)
}

/**
 * Appends `prunify-reports/` to `.gitignore` if not already present.
 */
export function appendToGitignore(rootDir: string): void {
  const gitignorePath = path.join(rootDir, '.gitignore')
  const entry = `${REPORTS_DIR_NAME}/`

  if (fs.existsSync(gitignorePath)) {
    const contents = fs.readFileSync(gitignorePath, 'utf-8')
    if (contents.split('\n').some((line) => line.trim() === entry)) return
    fs.appendFileSync(gitignorePath, `\n${entry}\n`, 'utf-8')
  } else {
    fs.writeFileSync(gitignorePath, `${entry}\n`, 'utf-8')
  }
}

/**
 * Converts a byte count to a human-readable string: "4.2 KB", "1.1 MB", etc.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// ─── Markdown / JSON writers ──────────────────────────────────────────────────

export interface ReportSection {
  title: string
  rows: string[][]
  headers?: string[]
}

export interface Report {
  title: string
  summary: string
  sections: ReportSection[]
  generatedAt: Date
}

/**
 * Writes a Markdown report to `outputPath`.
 */
export function writeMarkdown(report: Report, outputPath: string): void {
  const lines: string[] = [
    `# ${report.title}`,
    '',
    `> ${report.summary}`,
    '',
    `_Generated: ${report.generatedAt.toISOString()}_`,
    '',
  ]

  for (const section of report.sections) {
    lines.push(`## ${section.title}`, '')

    if (section.rows.length === 0) {
      lines.push('_Nothing found._', '')
      continue
    }

    if (section.headers && section.headers.length > 0) {
      lines.push(`| ${section.headers.join(' | ')} |`)
      lines.push(`| ${section.headers.map(() => '---').join(' | ')} |`)
    }

    for (const row of section.rows) {
      lines.push(`| ${row.join(' | ')} |`)
    }

    lines.push('')
  }

  ensureDir(path.dirname(outputPath))
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8')
}

/**
 * Writes a JSON report to `outputPath`.
 */
export function writeJson(data: unknown, outputPath: string): void {
  ensureDir(path.dirname(outputPath))
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')
}

function ensureDir(dir: string): void {
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
