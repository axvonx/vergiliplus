# CLAUDE.md — vergiliplus

Static browser of Windows struct/union/enum layouts from Microsoft's **public PDBs**:
kernel (`ntoskrnl`) and userland (`ntdll`) across 22 x64 builds (XP x64 → Canary), live at
https://vergiliplus.com. Not a fork of Vergilius; it borrows only its look.

## Map

```
tools/build.py        manifest data/sources.json -> data/<module>-<build>-<arch>.json
  pe_pdbid.py         PE -> RSDS identity + FileVersion        (importable)
  pdb_to_json.py      llvm-pdbutil dump -types -> doc          (importable: convert/write)
  check_links.py, check_budget.py   post-build gates (CI runs both)
web/src/lib/types.mjs    type graph + C declarators as segments ({t}, {t,kw}, {t,ref})
web/src/lib/layout.mjs   pahole rows: anonymous union/struct reconstruction, enums, usedIn, layoutText
web/src/lib/panel.mjs    layout -> panel HTML; each distinct panel is one /f/<hash>.html, shared by builds
web/src/lib/catalog.mjs  all docs loaded once + cross-build indexes + memoized per-doc views
web/src/lib/modules.mjs  module -> ring/label
web/public/assets/       site.css, nav.js (sidebar, ⌘K, filters, home links), struct.js (Metadata/copy)
web/public/logo.svg      site logo, a circle (Earth's interior, fully opened); favicon.svg = same in an octagon
tests/render.test.mjs    golden fixtures in tests/golden/ = the renderer's spec
```

```sh
(cd web && pnpm install && pnpm test && pnpm build && pnpm preview)
python3 tools/check_links.py && python3 tools/check_budget.py
VP_IMAGES=/path/to/disk-images python3 tools/build.py --skip-render [--only <substr>]
```

## Rules

- **Portable, dependency-light.** The Python is stdlib only. External tools are
  `llvm-pdbutil` (+ `llvm-undname` beside it), `wimlib-imagex` and `7z`, found via PATH
  (or `$LLVM_PDBUTIL`).
  No hardcoded paths, no mounts, nothing macOS-specific.
- **No personal paths in the repo.** The manifest roots images at `$VP_IMAGES`. History
  was scrubbed once before the first push; keep it that way.
- **Build labels come from the binaries**: image Build.SPBuild, else the kernel's
  FileVersion. All modules of one image share its label, so module pairs line up.
  Win10 22H2 honestly shows 10.0.19041.x. A manifest `"build"` overrides.
- **Prefer `msdl` manifest entries** where winbindex.m417z.com knows the file. They need
  no local media. Canary builds come from UUP sets (`uup` entries). msdl's
  TimeDateStamp+SizeOfImage key **collides**: it can serve a different revision. So
  entries carry `version`; a sha256 mismatch passes only if the FileVersion matches, and
  a mismatching revision gets re-pinned by probing older ones. Pin both modules of a
  build to the same revision.
- **Opaque types**: names a PDB declares or mentions but never defines (forward
  declarations, plus struct/union/enum names that `llvm-undname` finds in public
  symbols, kept fully qualified, e.g. `AutoBoost::_AB_PRIORITY`). They live in
  `doc.opaque` ({name: kind}) and get a small page (declaration, "defined in", used
  in), dimmed in lists.
- **`data/*.json` is the committed artifact**: compact, and pruned to types reachable
  from the documented ones. Never commit PDBs, PEs or `web/dist/`.
- **Text first, HTML at the edge.** layout/types produce segments; only
  `panel.mjs` (via `html()`) emits markup. Plain-text output never strips tags.
- **Golden fixtures are the spec.** Change rendering → `UPDATE_GOLDEN=1 node --test
  tests/render.test.mjs` → review the fixture diff like code.
- **Page weight is a budget.** About 47k pages: 1 KB of template is about 47 MB of
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
- VC 7.x PDBs (XP x64 / 2003) have a V70 TPI header LLVM rejects. `readable()` dumps a
  patched temp copy without the hash stream, so pdbutil prints no forward-ref targets
  and `parse` resolves them by name. Check a nested struct's size after touching either.
- Vista/2008 and XP/2003 SP2 binaries came from the SP standalone packages on the
  Microsoft Update Catalog (`catalog.update.microsoft.com`), then pinned as `msdl`.
- "Documented" = the PDB record has a real field list. ntdll and ntoskrnl each define
  what they own and forward-declare the rest (`_TP_POOL` is full only in ntdll).
- Union reconstruction ambiguity: when the *last* alternative is the longest, its tail
  renders after the union. Offsets are still exact.
- Anything scaling with struct **size** rather than member count blows the heap.
  `_MI_HYPER_SPACE` (276 MB) is the test canary.
- `<unnamed-tag>` is MSVC's name for every anonymous aggregate. `loadDoc` drops it from
  `named`; layout inlines such members; `usedIn` credits the enclosing type.
- Pointer size comes from the doc's arch (`PTR_SIZE` in types.mjs).
- Type pages carry no layout: `data-frag` names a shared `/f/<hash>.html` panel that
  struct.js injects. Identical HTML ⇒ identical relative links, so sharing is safe;
  check_links.py checks each panel's links against every page that loads it.
- Per-page chrome is the budget's biggest line: anything listing every build belongs in
  a shared file. The build `<select>` ships one option + `data-has` (d/o/- per build);
  nav.js fills it from `/builds.json`. The palette markup is created by nav.js.
- `/search-index.json` is grouped: `{v: versions, m: modules, t: [[name, kind, slug,
  module#, [defined v#], [opaque v#]]]}` (~380 KB). Palette filters (kind, PDB, opaque,
  versions checklist) persist in localStorage `vp-ck`; it opens with `/` or ⌘K.
- PDBs cache in `$TMPDIR/vergiliplus-pdbs`, keyed by GUID+age.
- Stale `astro preview` servers keep their port; a new one silently moves.

## Open (undecided)

**Scale ceiling:** about 9 MB of `dist` per build (two modules: ~2.9 KB page shells plus
only the panels that changed), so 22 builds ≈ 195 MB of the ~1 GB Pages cap. Files: ~2.4k
per build; check_budget's 150k is a runaway guard (Pages documents no file limit).
Before x86/ARM64 or per-update builds, stop emitting one shell per build x type.
Cross-build diff / per-field history · adding ndis + fltmgr (`docs/module-survey.md`) ·
x86/ARM64 (winbindex has them; budget first) · more canary builds (UUP sets) · home
grouping (client/server/insider).

## Attribution

Code is MIT (`LICENSE`). The look deliberately follows vergiliusproject.com:
`web/public/assets/site.css` uses `web/vendor/verg.css`'s colour values, type scale and
component styling (© the Vergilius authors; their repo has no license). Their images and
logo are **not** reused: the faceted background is plain CSS and both logos are our own
art. Like verg.css, "Open Sans" is named but not loaded. Keep the footer credit and the
README License section.
