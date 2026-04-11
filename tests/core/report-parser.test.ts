import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  parseDeadCodeReportContent,
  parseAssetsReportContent,
} from '@/core/report-parser.js'

const root = '/proj'

describe('parseDeadCodeReportContent', () => {
  it('parses SAFE TO DELETE and TRANSITIVELY DEAD sections', () => {
    const txt = `
prunify 1.0.0 — date

========================================
  DEAD CODE REPORT
  Safe to delete     : 2
========================================

── SAFE TO DELETE ──
(stub)

  src/orphan.tsx  (~1.0 KB)
    └─ also makes dead: src/other.tsx

── TRANSITIVELY DEAD ──
(stub)

  src/chain.tsx  (~2.0 KB)

── DEAD EXPORTS ──

  src/live.tsx → unusedFn [line 10]
`
    const paths = parseDeadCodeReportContent(txt, root)
    expect(paths).toContain(path.join(root, 'src/orphan.tsx'))
    expect(paths).toContain(path.join(root, 'src/chain.tsx'))
    expect(paths).not.toContain(path.join(root, 'src/live.tsx'))
  })

  it('parses legacy DEAD FILE — lines', () => {
    const txt = `
========================================
  DEAD CODE REPORT
  Dead files : 2
========================================

── DEAD FILES ──

DEAD FILE — src/legacy-dead.ts
Reason: x
`
    const paths = parseDeadCodeReportContent(txt, root)
    expect(paths).toEqual([path.join(root, 'src/legacy-dead.ts')])
  })
})

describe('parseAssetsReportContent', () => {
  it('parses markdown table paths', () => {
    const md = `# Unused Assets

## Unused Assets

| Asset | Size (KB) |
| --- | --- |
| public/a.png | 1.2 |
| public/b.woff2 | 3.4 |
`
    const paths = parseAssetsReportContent(md, root)
    expect(paths).toContain(path.join(root, 'public/a.png'))
    expect(paths).toContain(path.join(root, 'public/b.woff2'))
  })
})
