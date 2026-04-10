import ora from 'ora'
import chalk from 'chalk'
import Table from 'cli-table3'
import { discoverFiles, buildProject, getImportsForFile } from '@/core/parser.js'
import { buildGraph, detectCycles, type ImportGraph } from '@/core/graph.js'
import { writeMarkdown } from '@/core/reporter.js'

// ─── Module API ───────────────────────────────────────────────────────────────

export interface CircularResult {
  cycles: string[][]
  report: string
}

/**
 * Synchronous, graph-only entry point used by the health-report orchestrator.
 * The import graph must already be built by the caller.
 */
export function runCircularModule(graph: ImportGraph): CircularResult {
  const cycles = detectCycles(graph)
  return { cycles, report: buildCircularReport(cycles) }
}

function buildCircularReport(cycles: string[][]): string {
  const lines: string[] = [
    '========================================',
    '  CIRCULAR IMPORTS',
    `  Cycles: ${cycles.length}`,
    '========================================',
    '',
  ]

  if (cycles.length === 0) {
    lines.push('  No circular imports detected.', '')
    return lines.join('\n')
  }

  lines.push('── CYCLES ──', '')
  for (let i = 0; i < cycles.length; i++) {
    const cycle = cycles[i]!
    lines.push(
      `Cycle ${i + 1}:`,
      `  ${[...cycle, cycle[0]].join(' → ')}`,
      `  Files involved: ${cycle.length}`,
      '',
    )
  }

  return lines.join('\n')
}

export interface CircularOptions {
  output?: string
}

/**
 * Detects circular import chains using DFS with a visited stack.
 */
export async function runCircular(dir: string, opts: CircularOptions): Promise<string[][]> {
  const spinner = ora(chalk.cyan('Scanning for circular imports…')).start()

  try {
    const fileList = discoverFiles(dir, [])
    const project = buildProject(fileList)
    const graph = buildGraph(fileList, (f) => {
      const sf = project.getSourceFile(f)
      return sf ? getImportsForFile(sf) : []
    })
    const cycles = detectCycles(graph)

    spinner.succeed(
      chalk.green(`Circular import scan complete — ${cycles.length} cycle(s) found`),
    )

    if (cycles.length === 0) {
      console.log(chalk.green('  No circular imports detected.'))
      return cycles
    }

    const table = new Table({ head: ['Cycle #', 'Files involved'] })
    cycles.forEach((cycle, i) => {
      table.push([chalk.yellow(String(i + 1)), cycle.map((f) => chalk.gray(f)).join('\n  → ')])
    })
    console.log(table.toString())

    if (opts.output) {
      writeMarkdown(
        {
          title: 'Circular Imports Report',
          summary: `${cycles.length} circular import chain(s) found`,
          sections: [
            {
              title: 'Circular Chains',
              headers: ['Cycle #', 'Files'],
              rows: cycles.map((cycle, i) => [String(i + 1), cycle.join(' → ')]),
            },
          ],
          generatedAt: new Date(),
        },
        opts.output,
      )
      console.log(chalk.cyan(`  Report written to ${opts.output}`))
    }

    return cycles
  } catch (err) {
    spinner.fail(chalk.red('Circular import scan failed'))
    throw err
  }
}
