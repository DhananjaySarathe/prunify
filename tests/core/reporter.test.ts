import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  formatBytes,
  ensureReportsDir,
  writeReport,
  appendToGitignore,
} from '@/core/reporter.js'

// ─── formatBytes ──────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats bytes below 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(4300)).toBe('4.2 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(Math.round(1.5 * 1024 * 1024))).toBe('1.5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
  })
})

// ─── Filesystem helpers ───────────────────────────────────────────────────────

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prunify-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ─── ensureReportsDir ─────────────────────────────────────────────────────────

describe('ensureReportsDir', () => {
  it('creates prunify-reports/ inside rootDir and returns its path', () => {
    const result = ensureReportsDir(tmpDir)
    expect(result).toBe(path.join(tmpDir, 'prunify-reports'))
    expect(fs.existsSync(result)).toBe(true)
  })

  it('uses outDir when provided', () => {
    const outDir = path.join(tmpDir, 'custom-out')
    fs.mkdirSync(outDir)
    const result = ensureReportsDir(tmpDir, outDir)
    expect(result).toBe(path.join(outDir, 'prunify-reports'))
    expect(fs.existsSync(result)).toBe(true)
  })

  it('is idempotent — does not throw if directory already exists', () => {
    ensureReportsDir(tmpDir)
    expect(() => ensureReportsDir(tmpDir)).not.toThrow()
  })
})

// ─── writeReport ──────────────────────────────────────────────────────────────

describe('writeReport', () => {
  it('writes content to reportsDir/filename', () => {
    const reportsDir = ensureReportsDir(tmpDir)
    writeReport(reportsDir, 'test.txt', 'hello world')
    const written = fs.readFileSync(path.join(reportsDir, 'test.txt'), 'utf-8')
    expect(written).toBe('hello world')
  })
})

// ─── appendToGitignore ────────────────────────────────────────────────────────

describe('appendToGitignore', () => {
  it('creates .gitignore with prunify-reports/ when none exists', () => {
    appendToGitignore(tmpDir)
    const contents = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8')
    expect(contents).toContain('prunify-reports/')
  })

  it('appends to an existing .gitignore', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore')
    fs.writeFileSync(gitignorePath, 'node_modules/\ndist/\n')
    appendToGitignore(tmpDir)
    const contents = fs.readFileSync(gitignorePath, 'utf-8')
    expect(contents).toContain('node_modules/')
    expect(contents).toContain('prunify-reports/')
  })

  it('is idempotent — does not duplicate the entry', () => {
    appendToGitignore(tmpDir)
    appendToGitignore(tmpDir)
    const contents = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8')
    const count = contents.split('\n').filter((l) => l.trim() === 'prunify-reports/').length
    expect(count).toBe(1)
  })
})
