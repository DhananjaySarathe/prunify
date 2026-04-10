// Dead module — never imported, should be flagged by prunify
export function unusedHelper(x: number): number {
  return x * 2
}

export const DEAD_CONSTANT = 'nobody imports me'
