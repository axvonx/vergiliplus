# vergiliplus — plan

Self-contained hand-off for the next session(s). Read this, then `CLAUDE.md`, then work.
Last updated 2026-11-01 (after the "implement PLAN.md" session).

## Where things stand

- **Data** — 13 builds × {ntoskrnl, ntdll} = 26 docs, x64, every build paired:
  Win7 SP1 6.1.7601.17514 · Win8 6.2.9200.16384 · Win8.1 6.3.9600.17415 ·
  2012 R2 6.3.9600.17031 · 2016 10.0.14393.693 · 2019 10.0.17763.737 ·
  Win10 22H2 10.0.19041.2006 · 2022 10.0.20348.587 · Win11 21H2 10.0.22000.194 ·
  24H2 10.0.26100.7824 · 2025 10.0.26100.32230 · Canary 10.0.28000.3231 / 10.0.29680.1000.
  Labels are derived from the binaries. Sources: msdl (24H2, 28000), UUP (29680), ISOs.
- **Site** — 27.6k static pages, ~10 s build, `dist` 281 MB, 0 broken links (409k).
  No islands: `nav.js` (sidebar + ⌘K) and `struct.js` (Metadata/copy/click-through).
- **Renderer** — anonymous union/struct reconstruction, inlined `<unnamed-tag>`
  members, enum tables, function-pointer signatures, bitfield bit positions,
  arch-aware pointer size. 16 golden/unit tests.
- **CI** — `.github/workflows/site.yml`: tests → build → link check → size budget →
  Pages artifact; deploy gated on repo variable `PAGES_ENABLED=true`.

## Decisions

| Decision | Choice |
|---|---|
| Site stack | Astro, static only; no islands (per-page runtime × 28k pages) |
| Hosting | GitHub Pages at **vergiliplus.com**. Repo **private** until settled. |
| Build labels | From the binaries: image Build.SPBuild (else kernel FileVersion); one label per image |
| Manifest | Rooted at `$VP_IMAGES`; prefer `msdl` entries (no local files) where winbindex has the PE |
| Cross-build history (E1) | **Deferred / undecided** — owner wants time to decide |

## Workstreams

| Step | Status |
|---|---|
| A1 Revision-qualified builds | ✅ |
| A2 Matched module pairs | ✅ all 13 builds paired |
| A3 Portable manifest | ✅ manifest. History rewrite: see D1 |
| A4 Golden tests | ✅ `tests/render.test.mjs`, `tests/golden/` |
| A5 Renderer completeness | ✅ (known ambiguity: longest-last union alternative, see CLAUDE.md) |
| B1 Static struct view | ✅ 479 MB/22 docs → 281 MB/26 docs |
| B2 Size budget | ✅ `tools/check_budget.py` (600 MB / 60k files) |
| C1 Module survey | ✅ `docs/module-survey.md` — add ndis + fltmgr; combase deferred |
| C2 Generalise modules | ✅ `web/src/lib/modules.mjs` |
| C3 x86 / ARM64 | ⚠️ renderer ready (`PTR_SIZE`); **no x86/ARM64 sources on hand** |
| C4 UUP ingest | ✅ `uup` kind; 29680 built from its UUP set |
| D1 GitHub repo + push | ⏳ needs owner go-ahead (history rewrite + first push) |
| D2 CI | ✅ workflow written, unrun until pushed |
| D3 Pages deploy | ✅ wired (`site`, CNAME); flip `PAGES_ENABLED` + Pages settings |
| D4 Licensing | ⏳ owner's choice |
| D5 README rewrite | ⏳ owner. README "Status"/"next steps" are now stale |
| E1 / E2 | deferred, unchanged |

## Open work (next session)

- **D1**: rewrite history so personal paths never reach GitHub (if not already done),
  rename `master` → `main`, push, watch the first CI run.
- **D4/D5**: license + README (owner).
- **C1 follow-up**: decide the budget, then add `"modules": [..., "ndis", "fltmgr"]`
  to image entries (~+25 MB per build).
- **C3 data**: add x86 (Win7–Win10 32-bit ISOs) and ARM64 (UUP) entries; the
  renderer, manifest and URL scheme already handle `arch`.
- **New canary builds**: fetch the UUP set into `$VP_IMAGES/windows/canary/canary-uup/<build>/UUPs`
  and add one `uup` entry; or, for builds winbindex knows, two `msdl` entries.

## Dependency graph & critical path

```
D1 (push) ──► D2 first run ──► D3 (PAGES_ENABLED)   ← critical path to launch
D4, D5 (owner) ─────────────► D3 (before public)
C1 follow-up (budget decision) ──► manifest modules
C3 data (needs x86/ARM64 media)
```

## Gotchas carried forward

- `pnpm build` works now (`allowBuilds: esbuild: true` in `web/pnpm-workspace.yaml`).
- Never re-read JSON per page: always go through `catalog()` / `rendererFor()`.
- Anything scaling with struct **size** (not member count) can blow the heap
  (`_MI_HYPER_SPACE`, 276 MB, is the test canary).
- Stale `astro preview` servers keep ports; a new one silently moves to another port.
- Don't run the large VMs alongside heavy builds.
- Image sources live under `$VP_IMAGES` (`windows/<release>/*.iso`,
  `windows/canary/canary-uup/<build>/UUPs`); PDBs cache in `$TMPDIR/vergiliplus-pdbs`.

## Resume

```sh
cd vergiliplus
(cd web && pnpm install)
VP_IMAGES=/path/to/disk-images python3 tools/build.py --skip-render   # only if data/ needs regenerating
(cd web && pnpm test && pnpm build && pnpm preview --port 4331)
python3 tools/check_links.py && python3 tools/check_budget.py
```
