# 🧹 prunify

> npm run clean. ship with confidence.

[![npm version](https://img.shields.io/npm/v/prunify.svg)](https://www.npmjs.com/package/prunify)
[![npm downloads](https://img.shields.io/npm/dw/prunify.svg)](https://www.npmjs.com/package/prunify)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**prunify** is a zero-config CLI that audits your TypeScript or JavaScript codebase for:

- 🗑️ **Dead files and exports** — files and named exports that are never imported anywhere
- 🔁 **Duplicate code** — functions with identical bodies or suspiciously similar names, duplicate constants
- ♻️ **Circular imports** — dependency cycles that can cause runtime bugs and build issues
- 📦 **Unused dependencies** — packages declared in `package.json` that are never imported
- 📊 **Health score** — a 0–100 score summarising all findings, with optional HTML gauge output

---

## Installation

```bash
# Global install
npm install -g prunify

# Or run directly without installing
npx prunify
```

---

## Quick Start

```bash
# Analyse the current directory
npx prunify

# Analyse a specific project
npx prunify --dir ./my-app

# Only check dead code and circular imports
npx prunify --only dead-code,circular

# CI mode — exits 1 if any issues found
npx prunify --ci
```

---

## CLI Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dir <path>` | `string` | `cwd` | Root directory to analyse. Must contain a `package.json`. |
| `--entry <path>` | `string` | auto-detected | Override the entry point file (e.g. `src/main.ts`). prunify auto-detects `pages/`, `app/`, `src/index.ts`, or reads `package.json` `"main"`. |
| `--only <modules>` | `string` | all | Comma-separated list of modules to run: `dead-code`, `dupes`, `circular`, `deps`, `health`. |
| `--ignore <pattern>` | `string` | — | Glob pattern to exclude from analysis. Repeatable. |
| `--out <path>` | `string` | `<dir>/prunify-reports/` | Directory to write report files to. |
| `--html` | `boolean` | `false` | Also generate `code_health.html` — a self-contained file with a colour-coded score gauge. |
| `--delete` | `boolean` | `false` | After analysis, prompt to permanently delete dead files. |
| `--ci` | `boolean` | `false` | Non-interactive CI mode. Exits with code `1` if any issues are found. |
| `-v, --version` | — | — | Print the installed version. |

### Examples

```bash
# Ignore test fixtures and generated files
npx prunify --ignore "tests/fixtures/**" --ignore "src/generated/**"

# Write reports to a custom folder
npx prunify --out reports/

# Full health report with HTML gauge
npx prunify --only health --html

# Specify entry point explicitly
npx prunify --dir ./packages/core --entry src/index.ts

# Delete dead files after confirming in prompt
npx prunify --delete

# Strict CI gate — fails the build if issues exist
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

Summary

┌────────────────────────┬───────┬────────────────────┐
│ Check                  │ Found │ Output File        │
├────────────────────────┼───────┼────────────────────┤
│ Dead Files / Exports   │ 7     │ dead-code.txt      │
│ Duplicate Clusters     │ 3     │ dupes.md           │
│ Unused Packages        │ 4     │ deps.md            │
│ Circular Deps          │ 2     │ circular.txt       │
└────────────────────────┴───────┴────────────────────┘
```

### Report files in `prunify-reports/`

| File | Contents |
|------|----------|
| `dead-code.txt` | Dead files with chain analysis and recoverable byte count |
| `dupes.md` | Duplicate function clusters with AI refactor prompts |
| `circular.txt` | Circular dependency chains |
| `deps.md` | Unused / missing packages |
| `code_health.txt` | Combined health score + all findings (with `--only health`) |
| `code_health.html` | Self-contained HTML with SVG gauge (with `--html`) |

---

## Add to `.gitignore`

prunify automatically appends `prunify-reports/` to your `.gitignore`. If you prefer to commit reports, remove the entry.

```gitignore
# added by prunify
prunify-reports/
```

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

A score of **≥ 80** is green, **50–79** is amber, **< 50** is red.

---

## Requirements

- Node.js **≥ 18**
- Works with TypeScript **and** JavaScript projects
- Reads `tsconfig.json` automatically for path-alias resolution

---

## Contributing

```bash
git clone https://github.com/YOUR_USERNAME/prunify.git
cd prunify
npm install
npm test         # run the test suite
npm run build    # compile to dist/
```

Issues and PRs are welcome at [github.com/YOUR_USERNAME/prunify](https://github.com/YOUR_USERNAME/prunify/issues).

---

## License

MIT
├── cli.ts              # Entry point
├── core/
│   ├── parser.ts       # File discovery + ts-morph AST parsing
│   ├── graph.ts        # Import graph builder + DFS/SCC traversal
│   └── reporter.ts     # Markdown/JSON output writer
├── modules/
│   ├── dead-code.ts
│   ├── dupe-finder.ts
│   ├── circular.ts
│   ├── dep-check.ts
│   └── health-report.ts
├── prompt-gen/
│   └── templates.ts    # LLM prompt generators
└── utils/
    ├── file.ts         # Glob + file helpers
    └── ast.ts          # ts-morph AST helpers
```

## License

MIT
