// Entry point. The other modules are reached only through an aliased import and
// import(), the way lazily loaded components are.
import { slugify as toSlug } from './aliased'

const { formatDate } = await import('./destructured')
const Palette = await import('./picked').then((mod) => mod.Palette)
const loadLazy = () => import('./lazy')

console.log(toSlug('Hello world'), formatDate(new Date()), Palette, loadLazy)
