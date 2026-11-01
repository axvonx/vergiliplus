# CLAUDE.md — vergiliplus

Guidance for Claude (and humans) working in this repo. Keep it current.
**Roadmap, decisions and the dependency graph live in [`PLAN.md`](PLAN.md) — read it first.**

## What this is

A static browser of **authoritative Windows type layouts** — struct/union/enum
definitions taken from Microsoft's **public PDBs** — covering **both kernel
(`ntoskrnl`) and user-mode (`ntdll`, …) modules**, across **many builds** including
canary/insider/server that the [Vergilius Project](https://github.com/VergiliusProject/vergilius-project)
(kernel-only, released builds) doesn't carry. It is *not* a fork of Vergilius's stack;
it reuses only its look (lifted CSS) and its declaration-rendering idea.

## Pipeline (the whole thing)

```
PE ─tools/pe_pdbid.py→ sym-path + FileVersion ─tools/fetch_pdb.sh→ <module>.pdb
   ─tools/pdb_to_json.py (llvm-pdbutil dump -types)→ data/<module>-<build>-<arch>.json
   ─web/ (Astro, pnpm)→ static site  web/dist/
tools/build.py  = the batch driver over a manifest (data/sources.json)
tools/check_links.py, tools/check_budget.py = post-build gates (CI runs both)
tests/render.test.mjs = golden tests over render.mjs (fixtures in tests/golden/)
```

Site URL scheme (web/src/pages): `/` versions home · `/v/<arch>/<build>/<module>.html`
type listing · `/v/<arch>/<build>/<module>/<Type>.html` type page ·
`/ti/<arch>/<build>/<module>.json` sidebar index · `/search-index.json` ⌘K index.
`web/src/lib/render.mjs` is the type→C renderer + `catalog()` (all docs loaded once,
memoized — never re-read JSON per page). `web/src/lib/modules.mjs` is the module
table (ring + label). Pages are static HTML: no islands, no Preact. Behaviour lives in
two vanilla scripts, `web/public/assets/nav.js` (sidebar + ⌘K) and `struct.js`
(Metadata toggle, copy, row click-through). Every byte of per-page chrome is ×~28k
pages, so keep it out of the page template.

No server, no database, no self-scrape (Vergilius uses Spring Boot + MySQL +
`wget --mirror`; we don't). `{module, arch, build, family}` are first-class in the
JSON and the URL.

## Build

```sh
(cd web && pnpm install)
export VP_IMAGES=/path/to/disk-images   # root of the image/UUP paths in the manifest
python3 tools/build.py                  # reads data/sources.json, writes JSON, builds web/dist
python3 tools/build.py --skip-render    # data only;  --only <substr> for one entry
(cd web && pnpm test && pnpm build && pnpm preview)
python3 tools/check_links.py && python3 tools/check_budget.py
```

Full build is ~10 s for ~27.6k pages, `dist` ≈ 281 MB. Watch for pathological types
(e.g. `_MI_HYPER_SPACE` is 276 MB): anything that scales with struct *size* rather
than member count will blow the heap. The golden tests include it as a canary.
After an intended rendering change, `UPDATE_GOLDEN=1 node --test tests/` and review
the fixture diff like code.

Manifest entries (`data/sources.json`) are one of:
- `{"msdl": "ntdll.dll", "timestamp", "size", "sha256", "module","arch","family"}` — the
  PE itself from msdl's binary store (indexed by TimeDateStamp+SizeOfImage; look them up
  on winbindex.m417z.com). Needs no local files; the most reproducible kind.
- `{"pdb": "...", "module","arch","build","family"}` — a local PDB (how others add builds
  they have; `build` required unless a `pe` is given too).
- `{"pe": "...", ...}` — a local PE; the matching PDB is fetched from msdl.
- `{"iso"|"wim"|"uup": "...", "arch","family", "modules":[...]}` — extract the module PEs
  from an install ISO, a WIM/ESD, or a UUP set (MetadataESD + package ESDs via wimlib
  `--ref`), then fetch PDBs. Needs `7z` (ISO only) + `wimlib`.

Paths expand `$VARS`/`~` and are relative to the manifest; the committed manifest
roots image paths at `$VP_IMAGES` and must never contain absolute personal paths.
**Build labels come from the binaries** (image Build.SPBuild, else PE FileVersion), not
the manifest. All modules of one image share its label, so module pairs line up.
`"build"` overrides. Win10 22H2 honestly reports 10.0.19041.x (it's an enablement
package on 19041).

## Dependencies

- **Required:** Python 3 (stdlib only — no pip deps), `llvm-pdbutil` (LLVM),
  `curl` (for PDB fetch).
- **Optional (ISO extraction only):** `7z`/`7zz` (p7zip) and `wimlib-imagex` (wimlib).
- Tool discovery is generic: `$LLVM_PDBUTIL` or PATH; `7z`/`7zz`/`7za`; `wimlib-imagex`/
  `wimextract`. **No hardcoded paths, nothing macOS-specific** — keep it that way.

## Conventions / gotchas

- **Keep it portable and dependency-light.** Python stdlib only; discover external
  tools via PATH/env; never hardcode `/opt/homebrew`, never use `hdiutil`/mounts.
- **The fragile part is parsing `llvm-pdbutil dump -types` text** in `pdb_to_json.py`.
  If llvm changes its dump format, the regexes there break — that's the first place to
  look if a new toolchain version yields empty/short output. (`pdb2yaml` is a more
  robust-but-verbose alternative if this ever needs hardening.)
- **The correct PDB is resolved from the PE's RSDS GUID.** Each doc also records its
  `fileVersion` and the PDB `{guid, age}`, so it can be re-fetched from msdl later.
- **A type is "documented" only if its PDB record has a real field list** (not a
  forward-ref). ntdll and ntoskrnl PDBs are complementary: each defines what it owns
  and forward-declares the other's types (e.g. `_TP_POOL` is full in ntdll, opaque in
  ntoskrnl). Opaque types render as plain (unlinked) names.
- **Anonymous unions/structs are reconstructed** (`units()` → `structItems()` →
  `alternatives()` in render.mjs). Bitfields first merge into storage units (same
  offset, rising bit `pos`; a reset to 0 means a new alternative). Then a unit whose
  offset is revisited later opens a union. Known ambiguity: a last alternative longer
  than the others has its tail rendered after the union (offsets still exact).
  `<unnamed-tag>` members are inlined as `struct { … } name;`.
- **Pointer size comes from the doc's arch** (`PTR_SIZE`), so x86/ARM data needs no
  renderer changes.

## Don't

- **Don't commit PDBs or PEs** (`*.pdb` gitignored; they're large and
  redistribution-dubious). The committed artifact is the derived `data/*.json`.
- **Don't commit `web/dist/`** (generated).
- `web/vendor/verg.css` (original) + `web/public/assets/dracula.css` are **lifted from the Vergilius Project** and
  are © its authors — keep the attribution in README; a project LICENSE is still TODO
  (owner's choice).

## Status

See `PLAN.md` (single source of truth for open work).
