# CLAUDE.md — vergiliplus

Static browser of Windows struct/union/enum layouts from Microsoft's **public PDBs** (and,
before those carried types, the type records in its DDKs, SDKs and debuggers): kernel
(`ntoskrnl`) and userland (`ntdll`) across 22 x64 builds (XP x64 → Canary), 33 x86 (1991-92
pre-releases, NT 3.1 → Windows 10 22H2), 3 IA-64 (2003 SP1 → 2008 SP2), NT on MIPS (Apr/Dec
1991, Jul 1992, 3.1 betas 340/404, 3.1, 3.5, 3.51, 4.0 beta 2, 4.0), Alpha (3.1 beta 438,
3.1, 3.5, 3.51, 4.0 beta 2, 4.0, 2000 RC2), PowerPC (3.51, 4.0 beta 2, 4.0) and ARM64
(24H2), live at
https://vergiliplus.com. Not a fork of Vergilius; it borrows only its look.

## Map

```
tools/build.py        manifest data/sources.json -> data/<module>-<build>-<arch>.json
  pe_pdbid.py         PE -> RSDS identity + FileVersion        (importable)
  pdb_to_json.py      llvm-pdbutil dump -types -> doc          (importable: convert/write);
                      parse20() reads PDB 2.0 (Windows 2000) itself, stdlib;
                      cv_records() = the one CodeView leaf decoder (16-bit + _ST)
  legacy/cv4.py       COFF .lib/.obj .debug$T (CV4) tables merged into one doc
  legacy/kdext.py     cross-check _EPROCESS/_ETHREAD vs a KDEXT*.DLL's !processfields
  legacy/cv3.py       1991 debuggers' CodeView 3 -> computed natural 32-bit layouts
  legacy/hsfs.py, pcjs.py, szdd.py, rawcd.py   High Sierra CD / PCjs disk JSON /
                      COMPRESS.EXE (NTOSKRNL.EX_) / raw BIN-MDF CD readers (fetch chain steps)
  legacy/strnames.py  type names a debug build's ASSERT text names (sizeof/cast/FIELD_OFFSET)
  legacy/headers.py   a DDK's/SDK's C headers -> computed layouts (clang + lld-link -> PDB); merge/check
  legacy/hstub/       one-line stand-ins for the C runtime headers DDKs include but don't ship
  check_links.py, check_budget.py   post-build gates (CI runs both)
web/src/lib/types.mjs    type graph + C declarators as segments ({t}, {t,kw}, {t,ref})
web/src/lib/layout.mjs   pahole rows: anonymous union/struct reconstruction, enums, usedIn, layoutText
web/src/lib/panel.mjs    type pages (one per arch x module x type) + packs; layout -> view HTML
web/src/lib/catalog.mjs  all docs loaded once + cross-build indexes + memoized per-doc views
web/src/lib/modules.mjs  module -> ring/label
web/public/assets/       site.css, nav.js (sidebar, ⌘K, context bar, home links), struct.js (#build router, Metadata/copy)
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
  `llvm-pdbutil` (+ `llvm-undname` beside it), `wimlib-imagex` and `7z` (plus `clang` and
  `lld-link`, for `headers` entries), found via PATH
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
- **Manifest kinds beyond `msdl`**: `sym` = a PDB straight from msdl by name+GUID+age
  (x86 Vista/7 `ntkrnlpa.exe` is not on msdl, its PDB is); `pkg` = a PDB inside an official
  symbol package (archive.org URL + sha256 + `member` chain unpacked with 7z): XP SP1,
  2003 SP1, Windows 2000 (msdl lacks them). `version` is the shipped binary's FileVersion.
- **x86 kernel = the PAE multiprocessor one** (`ntkrpamp.exe`, PDB `ntkrpamp.pdb`; Vista/7
  ship it as `ntkrnlpa.exe`; Windows 8+ x86 is PAE-only `ntoskrnl.exe`), module name stays
  `ntoskrnl`. x86 Win8+ PEs are not in winbindex: pin them with `msdl` entries from a PE
  extracted once from an ISO/ESD (msdl serves them). When the image's ntdll is a different
  revision than its kernel, the ntdll entry carries `"build"` = the kernel's label, as an
  image entry would (Win10 1703, 22H2).
- **Before public PDBs had types** (NT 3.x/4.0, Windows 2000 RTM-SP2) layouts come from
  type records Microsoft itself shipped: DDK/SDK libraries (`lib` manifest kind,
  `tools/legacy/`), 1991 kernel debuggers. Only Microsoft-published material (or an
  archive.org mirror of it, pinned by sha256) — never leaked source. Such a doc carries
  `provenance: {kind: "source"|"computed", note}` (per type: `provenanceTypes`), rendered as
  a last `/* kind: note */` code line (copy includes it). Pre-release builds without a
  number have a sortable `build` key (`0.1991.10.0`) and `buildLabel: "no build number"`,
  shown wherever builds are (the exception to "labels come from binaries"). Partial builds
  carry `incomplete: "<why>"`: a red `incomplete` marker on home, select and type page.
  An `untyped` struct (NT 3.51 kernel: names+offsets from KDEXT's !processfields) has
  members with `type: null`, rendered `/* type unknown */`, without holes, sizes or size.
  Where a build's sources define a type differently (`"variants": true` on a multi-file
  `lib` entry), `doc.variants = {name: [{type, note}]}` keeps each definition (the chosen
  one is `named[name]`); the page shows one at a time under a select (struct.js).
- **Opaque types**: names a PDB declares or mentions but never defines (forward
  declarations, plus struct/union/enum names that `llvm-undname` finds in public
  symbols, kept fully qualified, e.g. `AutoBoost::_AB_PRIORITY`). They live in
  `doc.opaque` ({name: kind}); in a build where a type is opaque its view is the
  declaration, "defined in" and used in. Dimmed in lists.
- **Header layouts** (`"headers"`: a pinned set of a DDK's C headers, files fetched one by
  one from the archive.org image, or out of a whole fetched `"image"` (a BIN/MDF archive.org
  can't list inside; `"rawcd"` step), `sha256` over "<sha256>  <path>\n" per sorted file):
  `tools/legacy/headers.py` preprocesses `ntddk.h` with the arch's macros, drops function
  bodies (and any top-level declaration clang rejects, warning if a type definition goes
  with it), compiles the rest as MSVC x86 with CodeView for every type, links a PDB and
  converts it: provenance `computed`. MSVC x86 rules give MIPS/Alpha/PPC's layouts too
  (checked: NT 4.0 libraries on all four arches, 404.1's MIPS binaries; every offset
  exact). `DEVL` is defined, as Microsoft's own builds had it (July 1992's WINNT.H keeps
  `_RTL_CRITICAL_SECTION`'s debug members under it; that build's binaries agree). The SDK's
  WINNT.H (`"top": "windef.h", "only": ["winnt.h"]`: just the types it defines) gives each
  release's ntdll doc, Dec 1991 → 4.0. A header is the *public* view: private members can
  be missing, a private struct may be declared only up to its public prefix (Alpha
  `_KPRCB`). So on a `lib` entry the records win: headers only add the types they lack
  (`provenanceTypes`), and the build fails if a header member the records also have sits
  elsewhere in them (by name: 1993 CodeView drops anonymous aggregates, so 404.1's
  `_LARGE_INTEGER` records only `QuadPart`). Alone, they are a build's doc
  (3.10.340.1, 3.10.404.1, 3.50.807), marked incomplete. Clang predefines `i386`; non-x86
  arches undefine it (1992 headers test it).
- **Attested names** (`"asserts"` on a `lib` entry): a debug build keeps each ASSERT's
  source text, and `sizeof(X)`, `FIELD_OFFSET(X, …)` and a pointer cast `(PX)` name a
  type for certain. Names the build has no layout for join `doc.opaque`, evidence in
  `doc.attested` ({page: {as, how, text, file[, members]}}), shown verbatim on the page
  (`/* named only */`). Page name: `_X` where a recorded doc has the tag `_X`, else `X`;
  kind from that doc, else `"type"` (unknown, no keyword). Never attribute members via
  variables (`Process->Pcb`): that's inference. Yield is tens per build, not hundreds
  (April 1991 kernel 18, all 95 December 1991 checked binaries 40, the 3.1-4.0 checked
  kernels 14-28). MSDN shipped checked kernels for 3.1 (July 1994 disc 2: the UP
  NTOSKRNL is checked, NTKRNLMP free), 3.5, 3.51 and 4.0; x86's compiler folds constant
  ASSERTs (`FIELD_OFFSET(A, x) == FIELD_OFFSET(B, x)`) away, so x86 names fewer than RISC.
- **`data/*.json` is the committed artifact**: compact, and pruned to types reachable
  from the documented ones. Never commit PDBs, PEs or `web/dist/`.
- **Text first, HTML at the edge.** layout/types produce segments; only
  `panel.mjs` (via `html()`) emits markup. Plain-text output never strips tags.
- **Golden fixtures are the spec.** Change rendering → `UPDATE_GOLDEN=1 node --test
  tests/render.test.mjs` → review the fixture diff like code.
- **URLs.** Type pages are `/t/<arch>/<module>/<slug>.html#<build>` (one per type, every
  build; `?m=<member>` highlights a member). Listings stay per build:
  `/v/<arch>/<build>/<module>.html`. Panel links are relative (`<Type>.html`); struct.js
  appends the shown build. Storage scales with *changes*, not builds × types.
- **Page weight is a budget.** About 3.9k pages: 1 KB of template is about 4 MB of
  `dist`. Behaviour belongs in
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
- A type page inlines its default build's view (newest defining build, else newest
  declaring one) so it reads and indexes without JS. Every other build comes from its
  pack, `/p/<arch>/<module>/<slug>.json.gz` = `{n: [build], v: [view html], u: [[used-in
  names]], b: [[v#, u#] | 0 per n]}`, gzipped at build time (Pages stores files as-is;
  struct.js inflates, and passes through a host that already decoded it). check_links.py
  unpacks each pack and checks its links against the page.
- struct.js routes on `#build` and fires `vp:build`; nav.js re-syncs the context bar
  (select, steps, module links) and the sidebar from `[data-tp]`'s `data-cur`. Keep
  `data-tp` unique to that root (the select's flag is `data-tsel`).
- Names differing only by case (`_TlgProvider_t` / `_tlgProvider_t`, renamed between
  builds) are one page, written under each spelling: a case-insensitive disk can't hold
  both, and on one, check_links matches case-insensitively.
- Anything listing every build belongs in a shared file: the build `<select>` ships one
  option + `data-has` (d/o/- per build) and nav.js fills it from `/builds.json`. The
  palette markup is created by nav.js.
- `/search-index.json` is grouped: `{v: versions, m: modules, t: [[name, kind, slug,
  module#, [defined v#], [opaque v#]]]}` (~380 KB). `/member-index.json` (`{f: [[member,
  [t#]]]}`, ~730 KB, enum values too) loads only when the palette's "members" filter is on.
  Filters (kind, PDB, opaque, members, versions) persist in localStorage `vp-ck`; the
  palette opens with `/` or ⌘K.
- PDBs cache in `$TMPDIR/vergiliplus-pdbs`, keyed by GUID+age.
- Stale `astro preview` servers keep their port; a new one silently moves.

- XP SP2 public PDBs (msdl) carry no types at all, so it is absent. Windows 2000 ntdll PDBs
  are stripped (kernel only). XP SP1 ntdll is a PDB 2.0 (read by `parse20`). PDB 2.0 has
  no hash/public streams: forward refs resolve by name, no mangled-name opaque types.
- Same build string on two arches is normal (`ntoskrnl-6.1.7601.17514-{x64,x86}.json`);
  the palette names the arch once there are two.
- CodeView 4 objects each restart type indices at 0x1000: `cv4.py` merges by name (the
  definition most objects agree on; the C runtime's own `_EXCEPTION_RECORD` disagrees and
  is reported, not mixed in) and hash-conses the rest. `__unnamed` → `<unnamed-tag>`.
  16-bit `LF_INDEX` is 0x0405 (0x0404 is `LF_FRIENDFCN`).
- Before NT 4.0 no Microsoft-published file found defines `_KTHREAD`/`_EPROCESS`
  (scanned: 1991-93 pre-release CDs and SDK/DDKs, NT 3.1 retail .dbg/kernels, 3.5/3.51
  DDKs). 1991 debuggers carry only what they decode; MIPS 1992-93 binaries carry NB08
  CodeView inline (`cv4.pe_type_tables`), Native-API/TEB/PEB/KPCR level. Build numbers
  only where the media state them (404.1: the DDK's version.h); else "no build number".
- ARM64 isn't in winbindex (x64 only): it comes from UUP sets. Only the edition's metadata
  ESD + `Microsoft-Windows-Client-Desktop-Required-Package.esd` (~1.35 GB) are needed;
  the image is the base build (26100.1), whatever the UUP set's update level.
- IA-64 2008 R2's kernel only ships as PA30 deltas in catalog updates (needs msdelta,
  i.e. Windows): absent. IA-64 2008 SP2 came from the SP's appended payload CAB.

## Open (undecided)

**Scale:** 79 builds over 7 arches ≈ 114 MB in ~26k files; a build adds ~1 MB (its new
types' pages and changed views); a new arch is another /t/ tree (x86 added ~23 MB).
Cross-build diff / per-field history · adding ndis + fltmgr (`docs/module-survey.md`) ·
more ARM64 builds · more canary builds (UUP sets) · home
grouping (client/server/insider).

## Attribution

Code is MIT (`LICENSE`). The look deliberately follows vergiliusproject.com:
`web/public/assets/site.css` uses `web/vendor/verg.css`'s colour values, type scale and
component styling (© the Vergilius authors; their repo has no license). Their images and
logo are **not** reused: the faceted background is plain CSS and both logos are our own
art. Like verg.css, "Open Sans" is named but not loaded. Keep the footer credit and the
README License section.
