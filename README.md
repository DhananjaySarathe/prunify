<div align="center">

# 🧹 prunify

**One command. See what to delete, dedupe, and fix—before it ships.**

[![npm version](https://img.shields.io/npm/v/prunify.svg?style=flat-square)](https://www.npmjs.com/package/prunify)
[![npm downloads](https://img.shields.io/npm/dw/prunify.svg?style=flat-square)](https://www.npmjs.com/package/prunify)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

</div>

---

## The cleanup debt TypeScript won’t warn you about

Your repo grew. Dead files, barrel re-exports nobody uses, duplicate 20-line blocks, `public/` junk, and `dependencies` you forgot about—**none of that shows up in TypeScript errors until it hurts.**  
**prunify** runs in seconds, writes reports under `prunify-reports/`, and optional **HTML + Cursor-ready prompts** so you actually clean up.

---

## What prunify does

Zero-config CLI: point it at a folder with `package.json`. It parses TS/JS, builds an import graph, and tells you **what’s unused, duplicated, circular, or lying in `package.json` / `public/`**—with file paths and sizes, not vague warnings.

---

## Who it’s for

| You are… | You get… |
|----------|-----------|
| **Solo / shipping fast** | A checklist: delete candidates, dead exports, dupes to merge |
| **On a team** | Same reports in CI (`--ci` exits 1 if anything’s found) |
| **Using Cursor / Copilot** | `ai_prompt.tsx` + reports = one paste to drive a safe cleanup pass |
| **On Next.js / Vite / plain TS** | Auto entry detection (`app/`, `pages/`, `src/main`, etc.) |

**Pain it kills:** “We’re afraid to delete anything” / “We don’t know what’s safe” / “deps and assets drift forever.”

---

## Sample run: input and output

From your project root:

```bash
npx prunify
```

Abbreviated output:

```text
🧹 prunify — npm run clean. ship with confidence.

✔ Parsed codebase — 142 file(s) found
✔ Import graph built — 389 edge(s)
✔ Dead code analysis complete — 3 safe to delete, 1 transitively dead, 12 dead export(s)
✔ Duplicate scan complete — 3 duplicate block(s) found
✔ Circular import analysis complete — 2 cycle(s) found
✔ Dependency audit complete — 4 issue(s) found
✔ Asset scan complete — 5 unused / 23 total

========================================
  DEAD CODE REPORT
  Safe to delete     : 3
  Transitively dead  : 1
  Dead exports       : 12
  Recoverable        : ~12.4 KB
========================================

┌───────────────────────────┬───────┬──────────────────────────┐
│ Check                     │ Found │ Output File              │
├───────────────────────────┼───────┼──────────────────────────┤
│ Circular Dependencies     │ 2     │ circular.txt             │
│ Duplicate Clusters        │ 3     │ dupes.md                 │
│ Unused Packages           │ 4     │ deps.md                  │
│ Unused Assets             │ 5     │ assets.md, assets.txt    │
└───────────────────────────┴───────┴──────────────────────────┘

  Agent prompt saved → …/prunify-reports/ai_prompt.tsx
```

Reports land in **`prunify-reports/`** (auto-suggested for `.gitignore`).

> **Optional:** add a terminal recording as `.github/assets/demo.gif` for newcomers.

---

## Install

```bash
# Try once — no install
npx prunify

# Or global
npm install -g prunify

# Or pin in the repo you’re cleaning
npm install -D prunify
```

**Requires Node.js ≥ 18.**

---

## CLI reference

```bash
# Default: all checks + reports
npx prunify

# Another repo
npx prunify --dir ./my-app

# Only what you care about
npx prunify --only dead-code,circular

# Custom entry (otherwise auto-detected)
npx prunify --entry src/main.tsx

# HTML health page
npx prunify --html

# CI: fail if any issues
npx prunify --ci

# Ignore paths (repeatable)
npx prunify --ignore "tests/fixtures/**" --ignore "src/generated/**"
```

**Interactive deletes** (uses last report when present—no full rescan needed):

```bash
npx prunify --delete              # dead code files from dead-code.txt
npx prunify --delete-assets       # unused files under public/
```

With **`--ci`**, `--delete` / `--delete-assets` **do not delete** (non-interactive).

| Flag | What it does |
|------|----------------|
| `--dir <path>` | Project root (must have `package.json`) |
| `--entry <path>` | Override entry file |
| `--only` | `dead-code`, `dupes`, `circular`, `deps`, `assets`, `health` (comma-separated) |
| `--ignore <glob>` | Exclude from analysis (repeatable) |
| `--out <path>` | Parent folder for `prunify-reports/` |
| `--html` | Writes `code_health.html` |
| `--delete` / `--delete-assets` | Prompted deletes (see table above) |
| `--ci` | Exit `1` if issues; no delete prompts |

---

## Reports and checks

- **Dead code** — Orphan files (safe + transitive chains), plus **dead exports** in still-imported modules  
- **Duplicates** — Same multi-line blocks across files → `dupes.md` with refactor-friendly context  
- **Circular imports** — Cycles as paths you can fix, not buried in bundler noise  
- **Dependencies** — `package.json` vs what `src/` imports (`deps.md`)  
- **Public assets** — Unreferenced files under `public/` (`assets.md` + readable `assets.txt`)  
- **Health score** — Optional combined report + HTML gauge  
- **Agent handoff** — `ai_prompt.tsx` exports a prompt + safety rules for AI-assisted cleanup  

Reads **`tsconfig.json`** path aliases. No config file required.

### Output files (`prunify-reports/`)

| File | Purpose |
|------|---------|
| `ai_prompt.tsx` | Paste-friendly agent prompt + guardrails |
| `dead-code.txt` | Safe / transitive / dead exports + sizes (`--delete`) |
| `circular.txt` | Import cycles |
| `dupes.md` | Duplicate blocks |
| `deps.md` | Unused / missing deps (from `src/` scan) |
| `assets.md` / `assets.txt` | Unused `public/` files |
| `health-report.md` | Combined health (`--only health`) |
| `code_health.html` | Visual gauge (`--html`) |

<details>
<summary><strong>How dead code is classified (click to expand)</strong></summary>

- **Safe to delete** — No in-repo importer; not an entry or ignored framework file (`next.config.*`, `middleware.*`, etc.).  
- **Transitively dead** — Only imported by files that are already dead.  
- **Dead exports** — File is still imported, but a named export isn’t used elsewhere (framework route files excluded where exports aren’t normal imports). Exports read through `import()` count as used; when prunify can’t tell which ones are read (for example `React.lazy(() => import('./x'))`), every export of that module does.

Circular files are **not** auto-marked as “safe to delete.”

</details>

---

## Typical workflows

- **Pre-release / quarterly cleanup** — Run once, triage `dead-code.txt` and `deps.md`  
- **After a big refactor** — Find barrels and exports that nothing imports anymore  
- **Onboarding a legacy app** — `circular.txt` + `dupes.md` show structural debt fast  
- **Shrinking deploy / disk** — Unused `public/` assets and removable files with size hints  
- **CI hygiene** — `npx prunify --ci` on PRs so debt doesn’t creep back silently  

---

## Compared to doing it by hand

| Approach | prunify |
|----------|---------|
| **Manual grep** | Misses graph edges, barrels, transitive orphans |
| **“Delete unused” in IDE only** | Often file-local; won’t give you `public/` or `package.json` drift |
| **Heavy enterprise suites** | prunify is one npm binary, seconds on typical apps, reports you can grep or feed to an agent |

**Caveats (honest):** `deps.md` scans **`src/`** imports—packages used only in root config, scripts, or non-`src` files need a manual check. Assets referenced only via runtime-built URLs can look “unused.” **Always review** before `--delete`.

---

## Contributing

```bash
git clone https://github.com/DhananjaySarathe/prunify.git
cd prunify
npm install
npm test
npm run build
```

Issues and PRs: [github.com/DhananjaySarathe/prunify](https://github.com/DhananjaySarathe/prunify).

For larger features, open an issue first.

---

## Feedback and stars

If **prunify** saved you time, **[star the repo](https://github.com/DhananjaySarathe/prunify)**—it helps others find it.  
Bugs / ideas: [Issues](https://github.com/DhananjaySarathe/prunify/issues).

---

## License

MIT © [Dhananjay Sarathe](https://github.com/DhananjaySarathe)
