// Handed on whole (`() => import(...)`), so every export counts as used.
export default function Lazy(): string {
  return 'lazy'
}

export const extra = 1
