import fs from 'node:fs'
import path from 'node:path'
import { minimatch } from 'minimatch'

/**
 * Recursively collects files under `dir` that match any of `patterns`
 * and do not match any of `ignore` patterns.
 */
export function glob(
  dir: string,
  patterns: string[],
  ignore: string[] = [],
): string[] {
  const results: string[] = []
  collect(dir, dir, patterns, ignore, results)
  return results
}

function collect(
  base: string,
  current: string,
  patterns: string[],
  ignore: string[],
  results: string[],
): void {
  let entries: fs.Dirent[]

  try {
    entries = fs.readdirSync(current, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name)
    const relativePath = path.relative(base, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      // For directories: exact matching only — `partial: true` would cause
      // patterns like `**/*.test.ts` to spuriously match directory names.
      const isIgnored = ignore.some((pattern) => minimatch(relativePath, pattern))
      if (!isIgnored) collect(base, fullPath, patterns, ignore, results)
    } else if (entry.isFile()) {
      const isIgnored = ignore.some((pattern) => minimatch(relativePath, pattern))
      if (!isIgnored) {
        const matches = patterns.some((pattern) => minimatch(relativePath, pattern))
        if (matches) results.push(fullPath)
      }
    }
  }
}

/**
 * Ensures a directory exists, creating it (and parents) if needed.
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Reads a file as UTF-8 text, returning `null` if it does not exist.
 */
export function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}
