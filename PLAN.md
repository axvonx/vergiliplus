# vergiliplus — plan

Self-contained hand-off for the next session(s). Read this, then `CLAUDE.md`, then work.
Baseline: commit `d634647` (2026-11-01).

## Where things stand

- **Data pipeline (Python, `tools/`)** — manifest `data/sources.json` → per-build type JSON in
  `data/` (committed artifact). Entry kinds: local `pdb`, local `pe` (PDB fetched from msdl),
  `iso` (7z + wimlib extract → msdl). Portable: no mounts, tool discovery via PATH/env.
- **Site (Astro + pnpm, `web/`)** — reads every `data/*.json` via `catalog()` in
  `web/src/lib/render.mjs`. 24,729 pages, ~11 s build, ~770 MB peak, `dist` ≈ 479 MB.
  Routes: `/` versions (userland/kernel) · `/v/<arch>/<build>/<module>.html` type listing ·
  `/v/<arch>/<build>/<module>/<Type>.html` type page · `/ti/…json` sidebar index ·
  `/search-index.json` ⌘K index. 0 broken links (521k checked).
- **Coverage** — x64 only; ntoskrnl × 12 builds, ntdll × 10 builds, Win7 SP1 → Server 2025 +
  Canary 28000/29680.
- **Settled UX** — two-pane shell (collapsible sidebar + main, metadata band at bottom),
  ⌘K palette (current context ranked first), version bar (module toggle · build switcher that
  keeps the type · prev/next over builds defining it), pahole-style struct view with one
  "Metadata" toggle (offset/size column, padding lines, cacheline markers), per-kind colour.

## Decisions

| Decision | Choice |
|---|---|
| Site stack | Astro (chosen over Eleventy/Vite after a spike, for ecosystem) |
| Hosting | GitHub Pages at **vergiliplus.com** (domain already aliased). Repo **private** until settled. |
| Order | Correctness (A) → Breadth (C) ∥ Ship (D). Lean pages (B) runs alongside from day one. |
| Cross-build history (diff + per-field history) | **Deferred / undecided** (E1) — user wants time to decide |
| Architecture | Stay static. No server, no database. |

## Workstreams

Each step lists what it **reads → writes**; edges below are only real read/write dependencies.

### A. Correctness
- **A1 Revision-qualified builds.** Read `VS_FIXEDFILEINFO` FileVersion from each PE; use it as
  the build string (ISO entries derive it automatically, manifest `build` becomes optional).
  Fixes the Win 8.1 / Server 2012 R2 `6.3.9600` collision. Reads tools/*.py → writes
  `tools/pe_pdbid.py` (or new `pe_version.py`), `tools/build.py`, regenerated `data/*.json`.
- **A2 Matched module pairs.** Every build should have both ntoskrnl and ntdll where possible.
  Known gap: 24H2 kernel is 26100.7824 but ntdll is 26100.7309; Canary builds have no ntdll.
  Source matching ntdll from the VM / UUP sets. Reads A1 labels → writes `data/`, manifest.
- **A3 Portable manifest.** `data/sources.json` currently embeds `~/…` and
  `${VP_IMAGES}/../…`. Make paths relative / env-rooted (`$VP_SOURCES` or a gitignored
  `sources.local.json` override). **Rewrite history before the first push** so those paths
  never land on GitHub (`git filter-repo` on `data/sources.json`, or recreate the first commit).
- **A4 Golden tests.** `tests/golden/` fixtures for ~10 landmark types: `_TP_POOL`, `_PEB`,
  `_TEB`, `_KTHREAD`, `_EPROCESS`, `_LIST_ENTRY`, `_UNICODE_STRING`, a large enum, a
  bitfield-heavy struct, and `_MI_HYPER_SPACE` (276 MB — perf/regression canary). Node test
  runner over `render.mjs` (`paholeText`, `paholeLayout`). Writes `tests/`, `web/package.json`.
- **A5 Renderer completeness** (gated by A4). Anonymous union/struct grouping (today: correct
  offsets, flat shape — `_PEB`/`_TEB`/`_KTHREAD` look wrong); enum value tables (enums
  currently fall back to a plain block); function-pointer signatures; bitfield bit offsets.
  Writes `web/src/lib/render.mjs`, `StructCode.jsx`.

### B. Lean pages (must-do for GitHub Pages' ~1 GB limit; grows ~20 MB/build)
- **B1 Static struct view.** Each type page carries its layout twice (SSR HTML + Preact island
  props JSON). Render StructCode as static HTML plus a ~2 KB vanilla script (hover, Metadata
  toggle, copy, click-through). Target: `dist` < 250 MB at 22 builds. Writes
  `StructCode.jsx` → `.astro` + `public/assets/struct.js`, `[type].astro`.
- **B2 Size budget.** Fail the build if `dist` exceeds a size / file-count budget. Reads B1.

### C. Breadth
- **C1 Module type survey.** Run `pdb_to_json.py` over candidate PDBs (win32k, win32kbase,
  win32kfull, kernelbase, kernel32, combase, hal, ci, fltmgr, tcpip, ndis, …) and record
  named-type counts. Keep modules above a threshold. Writes `docs/module-survey.md`.
- **C2 Generalise modules** (reads C1). `MODLABEL` and the ntdll=userland / ntoskrnl=kernel
  split are hardcoded (render.mjs, Sidebar, CmdK, index.astro). Replace with a module table
  `{module, ring: kernel|user, label}`; home groups by ring; version-bar toggle becomes a list.
- **C3 x86 / ARM64.** Manifest entries are ready, but **`PTR = 8` is hardcoded in render.mjs** —
  must come from the doc's arch (x86 = 4) or pointer sizes, array counts and holes are wrong.
  Then surface arch in home / version bar. Touches render.mjs → coordinate with A5.
- **C4 UUP / canary ingest** (reads A1). New manifest kind `uup` for the canary drops in
  `${VP_IMAGES}/isos/canary/canary-uup` (extract ntoskrnl/ntdll from
  .esd/.cab with wimlib/7z), plus a script to add new canary builds incrementally.
  **Unknown format effort — spike it early.**

### D. Ship
- **D1 GitHub repo** (private) + first push — after A3's history rewrite.
- **D2 CI** (GitHub Actions): pnpm install → astro build → link check (port the checker used
  this session into `tools/check_links.py`) → golden tests (A4) → size budget (B2).
- **D3 Pages deploy.** Actions → Pages; `site: "https://vergiliplus.com"` in
  `astro.config.mjs`; `web/public/CNAME` = `vergiliplus.com`. Note: Pages on a **private**
  repo needs a paid GitHub plan — otherwise deploy at the moment the repo goes public.
- **D4 Licensing.** Pick a code license; keep attribution for `web/vendor/verg.css`
  (Vergilius Project); short statement on symbol-derived data (Vergilius precedent).
- **D5 README rewrite** — owner.

### E. Deferred / undecided
- **E1 Cross-build history** — diff view between two builds (fields added/removed/moved/
  resized) and per-field history. The `typeBuilds` index in `catalog()` already gives the
  build list per type. Do not build until decided.
- **E2 Search scale** — `search-index.json` is 2.7 MB; shard by module/arch if it passes
  ~10 MB. Pagefind full-text was dropped (⌘K covers names); revisit only if asked.

## Dependency graph & critical path

```
A3 ──────────────► D1 ──► D2 ──► D3   (public on vergiliplus.com)
A4 ──► A5            ▲      ▲
 └───────────────────┼──────┘ (D2 runs A4's tests)
B1 ──► B2 ───────────┼──────────► D3
A1 ──► A2            │
 └──► C4 (spike early: long pole, unknown format)
C1 ──► C2
C3 (needs A5's render.mjs changes to land first or be coordinated)
```

- **Critical path to launch:** A3 → D1 → (A4 → D2) → (B1 → B2) → D3.
- **Start immediately, in parallel:** A3, A4, B1, C1, and a C4 spike — none depend on anything.
- **Long poles to hoist:** B1 (rewrite of the interactive view), A4 (fixture curation),
  C4 (UUP format unknown).
- Re-derive the critical path whenever a step finishes early, late, or fails.

## Gotchas carried from this session

- Run Astro binaries directly (`./node_modules/.bin/astro build|preview`), not `pnpm build`:
  pnpm 11's pre-script deps-verify re-runs install and fails on blocked esbuild/sharp scripts.
- Never re-read JSON per page — always go through `catalog()` / `rendererFor()` memoization.
- Anything that scales with struct **size** (not member count) can blow the heap:
  `_MI_HYPER_SPACE` is 276 MB (that's how the cacheline-marker OOM happened).
- Stale `astro preview` servers keep ports; a new one silently moves to another port.
- Memory: never run the 10 GB autoboost VM alongside heavy builds/Ghidra analysis.
- Sources: ISOs/VMs live on `${VP_IMAGES}/` (isos/, autoboost-vm/,
  autoboost-canary-vm/); kernel PDBs for 26100.7824/28000/29680 in `~/autoboost-re`.

## Resume

```sh
cd ~/vergiliplus
(cd web && pnpm install)
python3 tools/build.py --skip-render          # only if data/ needs regenerating
(cd web && ./node_modules/.bin/astro build && ./node_modules/.bin/astro preview --port 4331)
```
