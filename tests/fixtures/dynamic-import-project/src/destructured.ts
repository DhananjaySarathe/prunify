// Loaded with `const { formatDate } = await import(...)`: unusedDestructured is dead.
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function unusedDestructured(): void {}
