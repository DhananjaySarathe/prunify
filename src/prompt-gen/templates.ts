import type { DeadExport } from '@/modules/dead-code.js'
import type { DepIssue } from '@/modules/dep-check.js'

// Inline to avoid circular dependency with dupe-finder
interface DuplicateBlock {
  hash: string
  lines: number
  occurrences: Array<{ file: string; startLine: number }>
}

interface DupeClusterEntry {
  type: 'name' | 'structure'
  functions: Array<{ name: string; filePath: string; line: number; paramCount: number }>
}

/**
 * Generates an LLM prompt asking for refactoring suggestions based on dead exports.
 */
export function deadCodePrompt(entries: DeadExport[]): string {
  if (entries.length === 0) return ''

  const list = entries
    .map((e) => `- \`${e.exportName}\` in \`${e.filePath}\``)
    .join('\n')

  return `You are a senior TypeScript engineer. The following exports appear to be unused across the codebase:

${list}

For each item, suggest whether it should be:
1. Deleted entirely
2. Made internal (remove the \`export\` keyword)
3. Kept with justification

Be concise. Format your answer as a Markdown list.`
}

/**
 * Generates an LLM prompt asking for refactoring suggestions based on duplicates.
 */
export function dupesPrompt(blocks: DuplicateBlock[]): string {
  if (blocks.length === 0) return ''

  const list = blocks
    .map(
      (b) =>
        `- Hash \`${b.hash.slice(0, 8)}\` (${b.lines} lines) appears in:\n` +
        b.occurrences.map((o) => `    - ${o.file}:${o.startLine}`).join('\n'),
    )
    .join('\n')

  return `You are a senior TypeScript engineer. The following code blocks appear duplicated across the codebase:

${list}

For each group, suggest the best refactoring strategy:
1. Extract to a shared utility function
2. Create a shared module
3. Use a generic/parameterised version

Be concise. Format your answer as a Markdown list.`
}

/**
 * Generates an LLM prompt asking for remediation advice for dependency issues.
 */
export function depCheckPrompt(issues: DepIssue[]): string {
  if (issues.length === 0) return ''

  const list = issues.map((i) => `- \`${i.name}\`: ${i.type}`).join('\n')

  return `You are a senior Node.js engineer. The following dependency issues were found in package.json:

${list}

For each item:
- **unused**: Confirm whether it can be safely removed or if it is needed as a peer/in scripts.
- **missing**: Suggest the correct package name and install command.

Be concise. Format your answer as a Markdown list.`
}

/**
 * Generates an LLM prompt asking for refactoring suggestions for a set of
 * duplicate function clusters.
 */
export function dupeClusterPrompt(clusters: DupeClusterEntry[]): string {
  if (clusters.length === 0) return ''

  const list = clusters
    .map((c) => {
      const label = c.type === 'name' ? 'similar name' : 'identical structure'
      const fns = c.functions
        .map((f) => `    - \`${f.name}\` in \`${f.filePath}\` (line ${f.line}, ${f.paramCount} param(s))`)
        .join('\n')
      return `- Cluster [${label}]:\n${fns}`
    })
    .join('\n')

  return `You are a senior TypeScript engineer. The following functions appear to be duplicated:\n\n${list}\n\nFor each cluster, suggest the best refactoring strategy:\n1. Extract to a shared utility function\n2. Merge with a generic/parameterised version\n3. Rename for clarity (name-similarity clusters only)\n\nBe concise. Format your answer as a Markdown list.`
}

/**
 * Cursor/Copilot-ready prompt for consolidating a duplicate function cluster.
 * `codeSnippets` maps `"filePath:line"` → source text of the function body.
 */
export function generateDupePrompt(
  cluster: DupeClusterEntry,
  codeSnippets: Map<string, string>,
): string {
  const fns = cluster.functions
  const fnType = cluster.type === 'name' ? 'similarly-named' : 'structurally identical'
  const firstName = fns[0]?.name ?? 'unknown'
  const canonicalPath = `src/utils/${toKebabCase(firstName)}.ts`

  const implementations = fns
    .map((f) => {
      const snippet = codeSnippets.get(`${f.filePath}:${f.line}`) ?? '// (source not available)'
      return `File: ${f.filePath}:${f.line}\n\`\`\`typescript\n${snippet}\n\`\`\``
    })
    .join('\n\n')

  return `I have ${fns.length} ${fnType} functions across my codebase. Here are their implementations:

${implementations}

Please consolidate them into a single utility function at \`${canonicalPath}\` that handles all edge cases, then show me the updated import paths for each file that currently uses the duplicate versions.`
}

/**
 * Cursor/Copilot-ready prompt for breaking a specific circular import cycle.
 * Suggests extracting shared types into a new module to break the cycle.
 */
export function generateCircularDepPrompt(cycle: string[]): string {
  const fileList = cycle.map((f, i) => `${i + 1}. \`${f}\``).join('\n')
  const arrow = cycle.join(' → ')

  return `My TypeScript project has a circular import chain:

${arrow}

The files involved are:
${fileList}

Please suggest how to break this cycle by extracting shared types, interfaces, or constants into a new module (e.g. \`src/types/shared.ts\` or a barrel index). Show the specific imports that should move, what the new file should contain, and the updated import statements for each affected file.`
}

/**
 * Cursor/Copilot-ready prompt for removing unused npm packages.
 */
export function generateUnusedDepPrompt(packages: string[]): string {
  const pkgList = packages.map((p) => `- \`${p}\``).join('\n')

  return `The following npm packages are declared in package.json but appear to be unused in the codebase:

${pkgList}

For each package:
1. Confirm whether it is safe to remove (check for implicit peer-dep usage, CLI tools, type-only imports, or runtime require() calls that static analysis may miss).
2. If safe to remove, provide the exact \`npm uninstall\` command.
3. If it should be kept, explain why.

Format your answer as a Markdown list, one item per package.`
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`)
    .replace(/^-/, '')
    .toLowerCase()
}
