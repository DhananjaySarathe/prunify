// Imported as `slugify as toSlug`: slugify is used, unusedAliasTarget is dead.
export function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-')
}

export function unusedAliasTarget(): void {}
