# Changelog

## Unreleased

### Fixed

- **Dead exports from `import()`.** Exports used only through a dynamic import (`next/dynamic`, `React.lazy`, lazy routes) were reported as dead, because only static `import` declarations were read. prunify now records the exports the code takes from the module: `import('./x').then((m) => m.a)`, `.then(({ a }) => …)`, `const { a } = await import('./x')`, `(await import('./x')).a`, and property reads on a variable holding the module. When it can't tell which exports are read, as with `lazy(() => import('./x'))`, every export of that module counts as used, the same as `import * as`.
- **Aliased imports.** `import { a as b }` marked the local name `b` as used instead of the export `a`, so `a` could be reported as dead. `import { default as X }` now counts as a use of the default export.
