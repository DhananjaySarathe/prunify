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
| 🗑️ **Dead code** | Files and named exports that are never imported anywhere in the codebase |
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

✔ Dead code analysis complete — 7 item(s) found
✔ Duplicate scan complete — 3 duplicate block(s) found
✔ Circular import analysis complete — 2 cycle(s) found
✔ Dependency audit complete — 4 issue(s) found
✔ Asset scan complete — 5 unused / 23 total

Summary

┌──────────────────────┬───────┬──────────────────┐
│ Check                │ Found │ Output File      │
├──────────────────────┼───────┼──────────────────┤
│ Dead Files / Exports │ 7     │ dead-code.txt    │
│ Duplicate Clusters   │ 3     │ dupes.md         │
│ Unused Packages      │ 4     │ deps.md          │
│ Circular Deps        │ 2     │ circular.txt     │
│ Unused Assets        │ 5     │ assets.md        │
└──────────────────────┴───────┴──────────────────┘
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
| `--delete` | `false` | After analysis, prompt to permanently delete dead files. |
| `--ci` | `false` | Non-interactive mode. Exits `1` if any issues are found. |
| `-v, --version` | — | Print the installed version. |

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

# Delete dead files after reviewing
npx prunify --delete

# Strict CI gate — fails the build if any issues exist
npx prunify --ci
```

---

## Report Files

All reports are written to `prunify-reports/` (auto-added to `.gitignore`).

| File | Contents |
|------|----------|
| `dead-code.txt` | Dead files and exports with chain analysis and recoverable byte count |
| `dupes.md` | Duplicate function clusters with AI-ready refactor prompts |
| `circular.txt` | Circular dependency chains |
| `deps.md` | Unused packages |
| `assets.md` | Unused files found in `public/` with sizes |
| `health-report.md` | Combined report with health score (with `--only health`) |
| `code_health.html` | Self-contained HTML page with SVG score gauge (with `--html`) |

---

## How Dead Code Detection Works

prunify builds a directed import graph of your entire codebase, then runs a depth-first traversal starting from your entry points.

**Entry point auto-detection order:**

1. Next.js — all files inside `pages/` and `app/` directories
2. `package.json` `"main"` and `"module"` fields
3. Common fallbacks — `src/main`, `src/index`, `src/App`, `index` (all TS/JS extensions)
4. If none found — files with no importers are used as roots (safest heuristic)

Any file not reachable from an entry point is flagged as dead. Circular dependencies are handled correctly — files in a cycle that are reachable from an entry point are always marked live.

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
│   ├── graph.ts            # Import graph builder, DFS traversal, cycle detection
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
