import chalk from 'chalk'
import fs from 'node:fs'
import path from 'node:path'
import { Project } from 'ts-morph'
import { runDeadCode } from '@/modules/dead-code.js'
import { runDupeFinder } from '@/modules/dupe-finder.js'
import { runCircular } from '@/modules/circular.js'
import { runDepCheck } from '@/modules/dep-check.js'
import { writeMarkdown } from '@/core/reporter.js'
import type { Report, ReportSection } from '@/core/reporter.js'
import type { DeadCodeResult } from '@/modules/dead-code.js'
import type { DupeCluster, ConstDupe } from '@/modules/dupe-finder.js'
import type { CircularResult } from '@/modules/circular.js'
import type { DepCheckResult } from '@/modules/dep-check.js'

export interface HealthReportOptions {
  output: string
}

/**
 * Orchestrates all analysis modules and writes a combined Markdown health report.
 */
export async function runHealthReport(dir: string, opts: HealthReportOptions): Promise<void> {
  console.log(chalk.bold.cyan('\n  prunify — Codebase Health Report\n'))

  const [deadExports, dupes, cycles, depIssues] = await Promise.all([
    runDeadCode(dir, {}).catch(() => []),
    runDupeFinder(dir, {}).catch(() => []),
    runCircular(dir, {}).catch(() => []),
    runDepCheck({ cwd: path.resolve(dir, '..'), output: undefined }).catch(() => []),
  ])

  const sections: ReportSection[] = [
    {
      title: '🚨 Dead Exports',
      headers: ['File', 'Export'],
      rows: deadExports.map((d) => [d.file, d.exportName]),
    },
    {
      title: '🔁 Duplicate Blocks',
      headers: ['Hash', 'Lines', 'Occurrences'],
      rows: dupes.map((d) => [d.hash.slice(0, 8), String(d.lines), String(d.occurrences.length)]),
    },
    {
      title: '♻️ Circular Imports',
      headers: ['Cycle #', 'Chain'],
      rows: cycles.map((cycle, i) => [String(i + 1), cycle.join(' → ')]),
    },
    {
      title: '📦 Dependency Issues',
      headers: ['Package', 'Issue'],
      rows: depIssues.map((i) => [i.name, i.type]),
    },
  ]

  const totalIssues =
    deadExports.length + dupes.length + cycles.length + depIssues.length

  const report: Report = {
    title: 'Codebase Health Report',
    summary: `Analysed: ${path.resolve(dir)} | Total issues: ${totalIssues}`,
    sections,
    generatedAt: new Date(),
  }

  writeMarkdown(report, opts.output)

  console.log(
    chalk.bold(`\n  Health report written to `) + chalk.cyan(opts.output),
  )
  console.log(
    chalk.dim(`  Total issues found: `) +
      (totalIssues > 0 ? chalk.red(String(totalIssues)) : chalk.green('0')),
  )
}

// ─── Module API ───────────────────────────────────────────────────────────────

export interface DupeModuleResult {
  clusters: DupeCluster[]
  constDupes: ConstDupe[]
}

export interface AllModuleResults {
  dead: DeadCodeResult
  circular: CircularResult
  deps: DepCheckResult
  dupes: DupeModuleResult
}

export interface HealthResult {
  score: number
  report: string
  html?: string
}

/**
 * Computes a codebase health score (0–100) from pre-computed module results,
 * builds a `code_health.txt` report, and optionally generates a self-contained
 * `code_health.html` with a colour-coded gauge.
 *
 * Scoring deductions:
 *  -2 per dead file          (max -20)
 *  -3 per dupe cluster       (max -15)
 *  -5 per circular dep       (max -20)
 *  -2 per unused package     (max -10)
 *  -1 per barrel ≥ 15 exports (max -10)
 *  -1 per file > 300 lines   (max -10)
 */
export function runHealthReportModule(
  allResults: AllModuleResults,
  project: Project,
  html?: boolean,
): HealthResult {
  const { dead, circular, deps, dupes } = allResults

  // ── Metrics ──────────────────────────────────────────────────────────────
  const deadFileCount = dead.safeToDelete.length + dead.transitivelyDead.length
  const dupeClusterCount = dupes.clusters.length
  const circularCount = circular.cycles.length
  const unusedPkgCount = deps.unusedPackages.length

  let barrelFileCount = 0
  let longFileCount = 0
  for (const sf of project.getSourceFiles()) {
    if (sf.getFilePath().endsWith('.d.ts')) continue
    // Barrel: file with 15+ distinct exported names
    const exportedCount = [...sf.getExportedDeclarations().keys()].length
    if (exportedCount >= 15) barrelFileCount++
    // Long file: > 300 lines
    if (sf.getEndLineNumber() > 300) longFileCount++
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  let score = 100
  score -= Math.min(deadFileCount * 2, 20)
  score -= Math.min(dupeClusterCount * 3, 15)
  score -= Math.min(circularCount * 5, 20)
  score -= Math.min(unusedPkgCount * 2, 10)
  score -= Math.min(barrelFileCount * 1, 10)
  score -= Math.min(longFileCount * 1, 10)
  score = Math.max(0, score)

  // ── Text report ───────────────────────────────────────────────────────────
  const report = buildHealthReport(
    score,
    dead,
    circular,
    deps,
    dupes,
    barrelFileCount,
    longFileCount,
  )

  // ── HTML report ───────────────────────────────────────────────────────────
  const htmlContent = html
    ? buildHealthHtml(score, dead, circular, deps, dupes, barrelFileCount, longFileCount)
    : undefined

  return { score, report, html: htmlContent }
}

// ─── Text report builder ──────────────────────────────────────────────────────

function buildHealthReport(
  score: number,
  dead: DeadCodeResult,
  circular: CircularResult,
  deps: DepCheckResult,
  dupes: DupeModuleResult,
  barrelFileCount: number,
  longFileCount: number,
): string {
  const grade = score >= 80 ? 'GOOD' : score >= 50 ? 'FAIR' : 'POOR'
  const lines: string[] = [
    '========================================',
    '  CODE HEALTH REPORT',
    `  Score : ${score}/100  (${grade})`,
    '  Generated: ' + new Date().toISOString(),
    '========================================',
    '',
  ]

  // Dead code section
  lines.push('── DEAD CODE ──', '')
  const totalDeadFiles = dead.safeToDelete.length + dead.transitivelyDead.length
  if (totalDeadFiles === 0 && dead.deadExports.length === 0) {
    lines.push('  No dead files or exports detected.', '')
  } else {
    if (dead.safeToDelete.length > 0) {
      lines.push(`  Safe to delete: ${dead.safeToDelete.length}`)
      for (const f of dead.safeToDelete) lines.push(`    • ${f}`)
      lines.push('')
    }
    if (dead.transitivelyDead.length > 0) {
      lines.push(`  Transitively dead: ${dead.transitivelyDead.length}`)
      for (const f of dead.transitivelyDead) lines.push(`    • ${f}`)
      lines.push('')
    }
    if (dead.deadExports.length > 0) {
      lines.push(`  Dead exports: ${dead.deadExports.length}`)
      for (const e of dead.deadExports)
        lines.push(`    • ${e.filePath}  →  ${e.exportName}  (line ${e.line})`)
      lines.push('')
    }
  }

  // Circular imports section
  lines.push('── CIRCULAR IMPORTS ──', '')
  if (circular.cycles.length === 0) {
    lines.push('  No circular imports detected.', '')
  } else {
    lines.push(`  Cycles: ${circular.cycles.length}`)
    for (let i = 0; i < circular.cycles.length; i++) {
      const cycle = circular.cycles[i]!
      lines.push(`  Cycle ${i + 1}: ${[...cycle, cycle[0]].join(' → ')}`)
    }
    lines.push('')
  }

  // Dependency check section
  lines.push('── DEPENDENCIES ──', '')
  if (deps.unusedPackages.length === 0) {
    lines.push('  All declared packages are used.', '')
  } else {
    lines.push(`  Unused packages: ${deps.unusedPackages.length}`)
    for (const p of deps.unusedPackages) lines.push(`    • ${p}`)
    lines.push('')
  }

  // Duplicate code section
  lines.push('── DUPLICATE CODE ──', '')
  if (dupes.clusters.length === 0 && dupes.constDupes.length === 0) {
    lines.push('  No duplicate functions or constants detected.', '')
  } else {
    if (dupes.clusters.length > 0) {
      lines.push(`  Function clusters: ${dupes.clusters.length}`)
      for (const c of dupes.clusters) {
        const label = c.type === 'name' ? 'similar-name' : 'identical-body'
        lines.push(`    [${label}] ${c.functions.map((f) => f.name).join(', ')}`)
      }
      lines.push('')
    }
    if (dupes.constDupes.length > 0) {
      lines.push(`  Duplicate constants: ${dupes.constDupes.length}`)
      for (const d of dupes.constDupes) lines.push(`    • ${d.name} = ${d.value}`)
      lines.push('')
    }
  }

  // Code quality section
  lines.push('── CODE QUALITY ──', '')
  lines.push(`  Barrel files (≥15 exports) : ${barrelFileCount}`)
  lines.push(`  Long files (>300 lines)     : ${longFileCount}`)
  lines.push('')

  // Deductions summary
  lines.push('── SCORE BREAKDOWN ──', '')
  lines.push(`  Starting score              : 100`)
  lines.push(`  Dead files  (-${Math.min((dead.safeToDelete.length + dead.transitivelyDead.length) * 2, 20)})`)
  lines.push(`  Dupe clusters (-${Math.min(dupes.clusters.length * 3, 15)})`)
  lines.push(`  Circular deps (-${Math.min(circular.cycles.length * 5, 20)})`)
  lines.push(`  Unused packages (-${Math.min(deps.unusedPackages.length * 2, 10)})`)
  lines.push(`  Barrel files (-${Math.min(barrelFileCount, 10)})`)
  lines.push(`  Long files (-${Math.min(longFileCount, 10)})`)
  lines.push(`  ─────────────────────────────────`)
  lines.push(`  Final score : ${score}/100`)
  lines.push('')

  return lines.join('\n')
}

// ─── HTML report builder ──────────────────────────────────────────────────────

function buildHealthHtml(
  score: number,
  dead: DeadCodeResult,
  circular: CircularResult,
  deps: DepCheckResult,
  dupes: DupeModuleResult,
  barrelFileCount: number,
  longFileCount: number,
): string {
  const gaugeColor = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'
  const grade = score >= 80 ? 'Good' : score >= 50 ? 'Fair' : 'Poor'

  // SVG donut gauge — full circle, filled proportionally
  const r = 54
  const circ = 2 * Math.PI * r
  const filled = (score / 100) * circ

  function section(emoji: string, title: string, count: number, rows: [string, string][]): string {
    const color = count === 0 ? '#22c55e' : '#f59e0b'
    const badge = `<span style="background:${color};color:#fff;border-radius:9999px;padding:1px 8px;font-size:0.75rem;margin-left:6px;">${count}</span>`
    const body =
      rows.length === 0
        ? `<p style="color:#6b7280;margin:0">None found ✓</p>`
        : `<table style="width:100%;border-collapse:collapse;font-size:0.85rem">
            <thead><tr style="background:#f3f4f6">${Object.keys(rows[0]!).map(() => '').join('')}</tr></thead>
            <tbody>
              ${rows.map(([a, b]) => `<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:4px 8px">${esc(a)}</td><td style="padding:4px 8px;color:#4b5563">${esc(b)}</td></tr>`).join('')}
            </tbody>
          </table>`
    return `
      <details style="margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <summary style="cursor:pointer;padding:12px 16px;font-weight:600;background:#f9fafb;user-select:none">
          ${emoji} ${esc(title)}${badge}
        </summary>
        <div style="padding:12px 16px">${body}</div>
      </details>`
  }

  const deadRows: [string, string][] = [
    ...dead.safeToDelete.map<[string, string]>((f) => [f, 'Safe to delete']),
    ...dead.transitivelyDead.map<[string, string]>((f) => [f, 'Transitively dead']),
    ...dead.deadExports.map<[string, string]>((e) => [`${e.filePath}:${e.line}`, `export ${e.exportName}`]),
  ]

  const circularRows: [string, string][] = circular.cycles.map<[string, string]>((c, i) => [
    `Cycle ${i + 1}`,
    [...c, c[0]].join(' → '),
  ])

  const depsRows: [string, string][] = deps.unusedPackages.map<[string, string]>((p) => [p, 'declared but never imported'])

  const dupeRows: [string, string][] = [
    ...dupes.clusters.map<[string, string]>((c) => [
      c.functions.map((f) => f.name).join(', '),
      c.type === 'name' ? 'similar name' : 'identical body',
    ]),
    ...dupes.constDupes.map<[string, string]>((d) => [`${d.name} = ${d.value}`, `${d.occurrences.length} occurrences`]),
  ]

  const qualityRows: [string, string][] = [
    [`Barrel files (≥15 exports)`, String(barrelFileCount)],
    [`Long files (>300 lines)`, String(longFileCount)],
  ]

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>prunify — Code Health Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f9fafb;color:#111827;padding:32px}
  h1{font-size:1.5rem;font-weight:700;margin-bottom:4px}
  .subtitle{color:#6b7280;font-size:0.875rem;margin-bottom:32px}
  .gauge-wrap{display:flex;flex-direction:column;align-items:center;margin-bottom:32px}
  .gauge-label{font-size:2.5rem;font-weight:800;margin-top:8px;color:${gaugeColor}}
  .grade{font-size:1rem;color:#6b7280;margin-top:2px}
  details summary::-webkit-details-marker{display:none}
  details summary::marker{display:none}
</style>
</head>
<body>
<h1>🧹 prunify — Code Health Report</h1>
<p class="subtitle">Generated ${new Date().toISOString()}</p>

<div class="gauge-wrap">
  <svg width="140" height="140" viewBox="0 0 140 140">
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="16"/>
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="${gaugeColor}" stroke-width="16"
      stroke-dasharray="${filled.toFixed(2)} ${circ.toFixed(2)}"
      stroke-linecap="round"
      transform="rotate(-90 70 70)"/>
    <text x="70" y="75" text-anchor="middle" font-size="24" font-weight="700" fill="${gaugeColor}">${score}</text>
  </svg>
  <div class="gauge-label">${score}/100</div>
  <div class="grade">${grade}</div>
</div>

${section('🗑️', 'Dead Code', deadRows.length, deadRows)}
${section('♻️', 'Circular Imports', circular.cycles.length, circularRows)}
${section('📦', 'Unused Dependencies', deps.unusedPackages.length, depsRows)}
${section('🔁', 'Duplicate Code', dupes.clusters.length + dupes.constDupes.length, dupeRows)}
${section('📐', 'Code Quality', barrelFileCount + longFileCount, qualityRows)}

<p style="margin-top:24px;font-size:0.75rem;color:#9ca3af">Score formula: 100 − 2×dead_files (max 20) − 3×dupe_clusters (max 15) − 5×circular (max 20) − 2×unused_pkgs (max 10) − barrel_files (max 10) − long_files (max 10)</p>
</body>
</html>`
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
