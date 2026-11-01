# CLAUDE.md — vergiliplus

Static browser of Windows struct/union/enum layouts from Microsoft's **public PDBs**:
kernel (`ntoskrnl`) and userland (`ntdll`) across 13 x64 builds, live at
https://vergiliplus.com. Not a fork of Vergilius; it borrows only its look.

## Map

```
tools/build.py        manifest data/sources.json -> data/<module>-<build>-<arch>.json
  pe_pdbid.py         PE -> RSDS identity + FileVersion        (importable)
  pdb_to_json.py      llvm-pdbutil dump -types -> doc          (importable: convert/write)
  check_links.py, check_budget.py   post-build gates (CI runs both)
web/src/lib/types.mjs    type graph + C declarators as segments ({t}, {t,kw}, {t,ref})
web/src/lib/layout.mjs   pahole rows: anonymous union/struct reconstruction, enums, usedIn, layoutText
web/src/lib/catalog.mjs  all docs loaded once + cross-build indexes + memoized per-doc views
web/src/lib/modules.mjs  module -> ring/label
web/public/assets/       site.css, nav.js (sidebar, ⌘K, filters, home links), struct.js (Metadata/copy)
web/public/logo.svg      site logo + favicon (Earth's interior, fully opened)
tests/render.test.mjs    golden fixtures in tests/golden/ = the renderer's spec
```

```sh
(cd web && pnpm install && pnpm test && pnpm build && pnpm preview)
python3 tools/check_links.py && python3 tools/check_budget.py
VP_IMAGES=/path/to/disk-images python3 tools/build.py --skip-render [--only <substr>]
```

## Rules

- **Portable, dependency-light.** The Python is stdlib only. External tools are
  `llvm-pdbutil`, `wimlib-imagex` and `7z`, found via PATH (or `$LLVM_PDBUTIL`).
  No hardcoded paths, no mounts, nothing macOS-specific.
- **No personal paths in the repo.** The manifest roots images at `$VP_IMAGES`. History
  was scrubbed once before the first push; keep it that way.
- **Build labels come from the binaries**: image Build.SPBuild, else the kernel's
  FileVersion. All modules of one image share its label, so module pairs line up.
  Win10 22H2 honestly shows 10.0.19041.x. A manifest `"build"` overrides.
- **Prefer `msdl` manifest entries** where winbindex.m417z.com knows the file. They need
  no local media. Canary builds come from UUP sets (`uup` entries).
- **`data/*.json` is the committed artifact**: compact, and pruned to types reachable
  from the documented ones. Never commit PDBs, PEs or `web/dist/`.
- **Text first, HTML at the edge.** layout/types produce segments; only
  `StructCode.astro` (via `html()`) emits markup. Plain-text output never strips tags.
- **Golden fixtures are the spec.** Change rendering → `UPDATE_GOLDEN=1 node --test
  tests/render.test.mjs` → review the fixture diff like code.
- **Page weight is a budget.** About 28k pages: 1 KB of template is about 28 MB of
  `dist` (budget 600 MB; GitHub Pages caps at ~1 GB). Behaviour belongs in
  `public/assets/*.js`, not inline. No islands, no frameworks.
- **Client JS:** use document-level delegation and re-sync on `astro:page-load`
  (ClientRouter, persisted sidebar). Guard double init (`window.__vpNav`/`__vpStruct`).
  Never call `scrollIntoView` (it scrolls the window too; use `nearest()` in nav.js).
- **`main` is production.** Every push deploys after the CI gates. Use branches for
  unfinished work.

## Gotchas

- `pdb_to_json.py` parses `llvm-pdbutil` **text**. If a new LLVM yields empty or short
  output, look at its regexes first.
- "Documented" = the PDB record has a real field list. ntdll and ntoskrnl each define
  what they own and forward-declare the rest (`_TP_POOL` is full only in ntdll).
- Union reconstruction ambiguity: when the *last* alternative is the longest, its tail
  renders after the union. Offsets are still exact.
- Anything scaling with struct **size** rather than member count blows the heap.
  `_MI_HYPER_SPACE` (276 MB) is the test canary.
- `<unnamed-tag>` is MSVC's name for every anonymous aggregate. `loadDoc` drops it from
  `named`; layout inlines such members; `usedIn` credits the enclosing type.
- Pointer size comes from the doc's arch (`PTR_SIZE` in types.mjs).
- PDBs cache in `$TMPDIR/vergiliplus-pdbs`, keyed by GUID+age.
- Stale `astro preview` servers keep their port; a new one silently moves.

## Open (undecided)

Cross-build diff / per-field history · adding ndis + fltmgr (`docs/module-survey.md`,
about +25 MB `dist` per build) · x86/ARM64 (needs media) · home grouping
(client/server/insider).

## Attribution

Code is MIT (`LICENSE`). `web/vendor/verg.css` is the Vergilius Project's original, and
`web/public/assets/site.css` adapts its palette, typography, wordmark and rem scaling.
Keep the README License section.
