import { describe, it, expect } from 'vitest'
import { buildAiPromptTsx } from '@/core/agent-prompt.js'

describe('buildAiPromptTsx', () => {
  it('exports a JSON-stringified prompt with safety rules and report file names', () => {
    const tsx = buildAiPromptTsx({
      prunifyVersion: '0.1.6',
      generatedAtIso: '2026-01-01T00:00:00.000Z',
      projectRootDisplay: '.',
      reportsDirDisplay: 'prunify-reports',
    })

    expect(tsx).toContain('export const PRUNIFY_CLEANUP_AGENT_PROMPT')
    expect(tsx).toContain('export default PRUNIFY_CLEANUP_AGENT_PROMPT')
    expect(tsx).toContain('dead-code.txt')
    expect(tsx).toContain('dupes.md')
    expect(tsx).toContain('deps.md')
    expect(tsx).toContain('assets.md')
    expect(tsx).toContain('circular.txt')
    expect(tsx).toContain('No bulk deletes')
    expect(tsx).toContain('Barrel files')
    expect(tsx).toContain('prunify 0.1.6')
  })

  it('uses a JSON string literal so special characters are safe', () => {
    const tsx = buildAiPromptTsx({
      prunifyVersion: '1.0.0',
      generatedAtIso: 'x',
      projectRootDisplay: 'p',
      reportsDirDisplay: 'r',
    })
    expect(tsx).toMatch(/PRUNIFY_CLEANUP_AGENT_PROMPT = "[\s\S]*" as const/)
  })
})
