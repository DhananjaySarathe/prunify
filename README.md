<div align="center">

# 🧹 prunify

**npm run clean. ship with confidence.**

[![npm version](https://img.shields.io/npm/v/prunify.svg?style=flat-square)](https://www.npmjs.com/package/prunify)
[![npm downloads](https://img.shields.io/npm/dw/prunify.svg?style=flat-square)](https://www.npmjs.com/package/prunify)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

</div>

---

**prunify** is a zero-config CLI that audits TypeScript and JavaScript codebases for dead code, duplicate logic, circular imports, unused dependencies, and unused public assets — then gives you a single health score so you know exactly where to clean up.

> **Add a demo GIF here** — record your terminal with [Terminalizer](https://github.com/faressoft/terminalizer) or [asciinema](https://asciinema.org) and drop the `.gif` in `.github/assets/demo.gif`

```
![prunify demo](.github/assets/demo.gif)
```

---

## What it detects

| Module | What it finds |
|--------|---------------|
| 🗑️ **Dead code** | **Safe to delete** (nothing imports them), **transitively dead** (only dead files import them), and **dead exports** (live files with unused named exports) |
| 🔁 **Duplicate code** | Functions with identical bodies, suspiciously similar names, and duplicate constants |
| ♻️ **Circular imports** | Dependency cycles that can cause runtime bugs and bundler issues |
| 📦 **Unused dependencies** | Packages declared in `package.json` that are never actually imported |
| 🖼️ **Unused assets** | Images, fonts, videos and other files in `public/` that are never referenced in source |
| 📊 **Health score** | A 0–100 score summarising all findings, with optional HTML gauge output |

---

## Installation

```bash
# Run directly (no install needed)
npx prunify

# Or install globally
npm install -g prunify
```

---

## Quick Start

```bash
# Analyse the current directory
npx prunify

# Analyse a specific project
npx prunify --dir ./my-app

# Run only specific checks
npx prunify --only dead-code,circular

# Override the entry point
npx prunify --entry src/main.tsx

# Generate an HTML report with health gauge
npx prunify --html

# CI mode — exits with code 1 if any issues found
npx prunify --ci
```

---

## Sample Output

```
🧹 prunify — npm run clean. ship with confidence.

✔ Parsed codebase — 142 file(s) found
✔ Import graph built — 389 edge(s)

✔ Dead code analysis complete — 3 safe to delete, 1 transitively dead, 3 dead export(s)
✔ Duplicate scan complete — 3 duplicate block(s) found
✔ Circular import analysis complete — 2 cycle(s) found
✔ Dependency audit complete — 4 issue(s) found
✔ Asset scan complete — 5 unused / 23 total

Summary

┌─────────────────────────────┬───────┬──────────────────┐
│ Check                       │ Found │ Output File      │
├─────────────────────────────┼───────┼──────────────────┤
│ Dead Code (files + exports) │ 7     │ dead-code.txt    │
│ Circular Dependencies       │ 2     │ circular.txt     │
│ Duplicate Clusters          │ 3     │ dupes.md         │
│ Unused Packages             │ 4     │ deps.md          │
│ Unused Assets               │ 5     │ assets.md        │
└─────────────────────────────┴───────┴──────────────────┘
```

---

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--dir <path>` | `cwd` | Root directory to analyse. Must contain a `package.json`. |
| `--entry <path>` | auto-detected | Override the entry point (e.g. `src/main.tsx`). prunify auto-detects `pages/`, `app/`, `src/index`, `src/main`, `src/App`, and common root entries. |
| `--only <modules>` | all | Comma-separated modules to run: `dead-code`, `dupes`, `circular`, `deps`, `assets`, `health`. |
| `--ignore <pattern>` | — | Glob pattern to exclude from analysis. Repeatable. |
| `--out <path>` | `<dir>/prunify-reports/` | Directory to write report files to. |
| `--html` | `false` | Generate `code_health.html` — a self-contained page with an SVG score gauge. |
| `--delete` | `false` | Prompt to permanently delete dead **code files** (safe to delete + transitively dead — not dead exports). See **Delete commands & cached reports** below. |
| `--delete-assets` | `false` | Prompt to delete unused files under `public/` from the asset report. Only paths inside `public/` are removed. See **Delete commands & cached reports** below. |
| `--ci` | `false` | Non-interactive mode. Exits `1` if any issues are found. With `--delete` / `--delete-assets`, does not prompt and does **not** delete files. |
| `-v, --version` | — | Print the installed version. |

### Delete commands & cached reports

When you use **`--delete`** or **`--delete-assets`**, prunify prefers your last report so you do not have to re-scan the whole repo every time:

| Flag | If the report already exists | If the report is missing |
|------|------------------------------|---------------------------|
| **`--delete`** | Reads file paths from `prunify-reports/dead-code.txt` (skips dead-code analysis and may skip building the import graph when no other module needs it). | Runs dead-code analysis, writes `dead-code.txt`, then prompts to delete. |
| **`--delete-assets`** | Reads paths from `prunify-reports/assets.md` (skips the asset scan). | Runs the asset scan, writes `assets.md`, then prompts to delete. |

- **`dead-code.txt`** starts with a line like `prunify <version> — <ISO timestamp>` so you know which run produced it.
- Keep your dependency on prunify up to date (e.g. `"prunify": "^0.1.5"` in `devDependencies`) so you get the latest detection logic; pinning an old exact version will not pick up fixes from npm.

### More examples

```bash
# Ignore test fixtures and generated files
npx prunify --ignore "tests/fixtures/**" --ignore "src/generated/**"

# Write reports to a custom folder
npx prunify --out ./reports

# Full health report as HTML
npx prunify --only health --html

# Only check unused public assets
npx prunify --only assets

# First run: analyse + write reports, then prompt to delete dead code files
npx prunify --delete

# Later: delete from existing dead-code.txt only (no graph build if e.g. --only deps)
npx prunify --only deps --delete

# Unused public assets: scan + prompt to delete
npx prunify --only assets --delete-assets

# Reuse assets.md only (no asset scan)
npx prunify --delete-assets

# Strict CI gate — fails the build if any issues exist
npx prunify --ci
```

---

## Report Files

All reports are written to `prunify-reports/` (auto-added to `.gitignore`).

| File | Contents |
|------|----------|
| `dead-code.txt` | Header with tool version + time, then **Safe to delete**, **Transitively dead**, and **Dead exports** sections (sizes and optional chains). Used by `--delete` when re-running deletes. |
| `dupes.md` | Duplicate function clusters with AI-ready refactor prompts |
| `circular.txt` | Circular dependency chains (relative paths; header with tool version + time) |
| `deps.md` | Unused packages |
| `assets.md` | Unused files found in `public/` with sizes (Markdown table). Used by `--delete-assets` when re-running deletes. |
| `health-report.md` | Combined report with health score (with `--only health`) |
| `code_health.html` | Self-contained HTML page with SVG score gauge (with `--html`) |

---

## How Dead Code Detection Works

prunify builds a directed import graph (with `tsconfig.json` path aliases) and a **reverse** map of “who imports this file”.

1. **Safe to delete** — No other project file imports this file, and it is not treated as an app entry (e.g. Next.js `pages/` / `app/` routes) or a known framework/config file (`next.config.*`, `middleware.*`, `tailwind.config.*`, etc.).
2. **Transitively dead** — The file is only imported by files that are already dead; removing the safe-to-delete roots would leave it orphaned.
3. **Dead exports** — The file is still used, but specific named exports are never imported by name elsewhere (namespace imports count as “all exports used”).

**Why not “reachable from entry” only?** A pure reachability scan from entry points can mark heavily shared modules as dead if any link in the chain fails to resolve. The importer-based model matches the usual meaning of “nothing uses this file.”

**Circular imports** are reported separately in `circular.txt`; they are not lumped into “safe to delete.”

---

## How the Health Score Works

Starting from **100**, points are deducted per finding:

| Finding | Deduction | Cap |
|---------|-----------|-----|
| Dead file | −2 | −20 |
| Duplicate function cluster | −3 | −15 |
| Circular dependency | −5 | −20 |
| Unused package | −2 | −10 |
| Barrel file (≥ 15 exports) | −1 | −10 |
| Long file (> 300 lines) | −1 | −10 |

| Score | Grade |
|-------|-------|
| ≥ 80 | 🟢 Good |
| 50–79 | 🟡 Fair |
| < 50 | 🔴 Poor |

---

## How Asset Detection Works

prunify scans your `public/` folder for image, font, video, and document files (`.png`, `.jpg`, `.svg`, `.webp`, `.woff2`, `.ttf`, `.mp4`, `.pdf`, and more).

For each asset it checks whether the filename or its public-root-relative path (e.g. `/icons/logo.svg`) appears anywhere in your source files — including TS, JS, CSS, SCSS, HTML, and JSON. Assets not referenced anywhere are flagged as unused.

> **Note:** Assets served via a CDN or referenced only at runtime (e.g. dynamically constructed URLs) may appear as unused. Review the report before deleting.

---

## Requirements

- **Node.js ≥ 18**
- Works with **TypeScript and JavaScript** projects
- Reads `tsconfig.json` automatically for path-alias resolution (`@/`, `~`, etc.)
- No config file needed

---

## Project Structure

```
src/
├── cli.ts                  # Entry point & CLI flag handling
├── core/
│   ├── parser.ts           # File discovery + ts-morph AST parsing
│   ├── graph.ts            # Import graph builder, cycle detection, reverse graph
│   ├── report-parser.ts    # Parse dead-code.txt / assets.md for --delete / --delete-assets
│   └── reporter.ts         # Markdown / JSON / HTML output writer
├── modules/
│   ├── dead-code.ts        # Dead file + dead export detection
│   ├── dupe-finder.ts      # Duplicate function + constant detection
│   ├── circular.ts         # Circular import detection
│   ├── dep-check.ts        # package.json dependency audit
│   ├── assets.ts           # Unused public asset detection
│   └── health-report.ts    # Health score + combined report
├── prompt-gen/
│   └── templates.ts        # AI prompt generators for refactor suggestions
└── utils/
    ├── file.ts             # Glob helpers
    └── ast.ts              # ts-morph AST helpers
```

---

## Contributing

Contributions are welcome! Here's how to get started:

```bash
git clone https://github.com/DhananjaySarathe/prunify.git
cd prunify
npm install

npm test          # run the test suite
npm run build     # compile to dist/
npm run dev       # watch mode
```

### Adding a new module

1. Create `src/modules/your-module.ts` — export a `run*Module(...)` (sync) and `run*(...)` (async CLI) function
2. Wire it into `src/cli.ts` — add to the `Module` type, `ALL_MODULES`, and the run block
3. Add tests in `tests/modules/your-module.test.ts`

Please open an issue first for large changes so we can discuss the approach.

---

## License

MIT © [Dhananjay Sarathe](https://github.com/DhananjaySarathe)
