import fs from 'node:fs'
import path from 'node:path'

/**
 * Parses `prunify-reports/dead-code.txt` for absolute paths of files that are
 * safe to delete or transitively dead (not dead-export lines).
 */
export function parseDeadCodeReportFile(reportPath: string, rootDir: string): string[] {
  if (!fs.existsSync(reportPath)) return []
  const content = fs.readFileSync(reportPath, 'utf-8')
  return parseDeadCodeReportContent(content, rootDir)
}

export function parseDeadCodeReportContent(content: string, rootDir: string): string[] {
  const lines = content.split(/\r?\n/)
  const paths: string[] = []

  // Legacy format: "DEAD FILE — relative/path.tsx"
  const legacyRe = /^DEAD FILE —\s+(.+)$/
  let legacyMode = content.includes('DEAD FILE —') && content.includes('Dead files :')

  if (legacyMode) {
    for (const line of lines) {
      const m = legacyRe.exec(line.trim())
      if (m) paths.push(path.resolve(rootDir, m[1]!.trim()))
    }
    return [...new Set(paths)]
  }

  let section: 'none' | 'safe' | 'transitive' = 'none'

  const fileLineRe = /^\s{2}(.+?)\s+\(~[\d.]+\s+KB\)\s*$/

  for (const line of lines) {
    if (line.includes('── SAFE TO DELETE ──')) {
      section = 'safe'
      continue
    }
    if (line.includes('── TRANSITIVELY DEAD ──')) {
      section = 'transitive'
      continue
    }
    if (line.includes('── DEAD EXPORTS ──')) {
      section = 'none'
      continue
    }
    if (line.startsWith('── ') && line.includes('──')) {
      if (section !== 'none' && !line.includes('SAFE TO DELETE') && !line.includes('TRANSITIVELY DEAD')) {
        section = 'none'
      }
      continue
    }

    if (section === 'safe' || section === 'transitive') {
      if (line.includes('└─') || line.includes('also makes dead')) continue
      const m = fileLineRe.exec(line)
      if (m) {
        const rel = m[1]!.trim()
        if (rel && !rel.startsWith('(')) {
          paths.push(path.resolve(rootDir, rel))
        }
      }
    }
  }

  return [...new Set(paths)]
}

/** Counts dead-export lines in a dead-code report (for summary when using cached report). */
export function countDeadExportsInReport(content: string): number {
  let section = false
  let n = 0
  for (const line of content.split(/\r?\n/)) {
    if (line.includes('── DEAD EXPORTS ──')) {
      section = true
      continue
    }
    if (section && line.startsWith('── ') && line.includes('──')) break
    if (section && /\s→\s.+\[line \d+\]/.test(line)) n++
  }
  return n
}

/**
 * Parses `prunify-reports/assets.md` markdown table for unused asset paths (relative to root).
 */
export function parseAssetsReportFile(reportPath: string, rootDir: string): string[] {
  if (!fs.existsSync(reportPath)) return []
  const content = fs.readFileSync(reportPath, 'utf-8')
  return parseAssetsReportContent(content, rootDir)
}

export function parseAssetsReportContent(content: string, rootDir: string): string[] {
  const lines = content.split(/\r?\n/)
  const paths: string[] = []
  let inTable = false
  let headerSeen = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('## Unused Assets')) {
      inTable = true
      headerSeen = false
      continue
    }
    if (inTable && trimmed.startsWith('## ')) {
      break
    }
    if (!inTable) continue

    if (trimmed.startsWith('|') && trimmed.includes('---')) {
      headerSeen = true
      continue
    }
    if (!headerSeen || !trimmed.startsWith('|')) continue

    const cells = trimmed
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean)
    if (cells.length >= 1) {
      const rel = cells[0]!
      if (rel.toLowerCase() === 'asset') continue
      if (rel.includes('---')) continue
      paths.push(path.resolve(rootDir, rel))
    }
  }

  return [...new Set(paths)]
}
