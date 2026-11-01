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
PE ─tools/pe_pdbid.py→ sym-path ─tools/fetch_pdb.sh→ <module>.pdb
   ─tools/pdb_to_json.py (llvm-pdbutil dump -types)→ data/<module>-<build>-<arch>.json
   ─web/ (Astro, pnpm)→ static site  web/dist/
tools/build.py  = the batch driver over a manifest (data/sources.json)
```

Site URL scheme (web/src/pages): `/` versions home · `/v/<arch>/<build>/<module>.html`
type listing · `/v/<arch>/<build>/<module>/<Type>.html` type page ·
`/ti/<arch>/<build>/<module>.json` sidebar index · `/search-index.json` ⌘K index.
`web/src/lib/render.mjs` is the type→C renderer + `catalog()` (all docs loaded once,
memoized — never re-read JSON per page).

No server, no database, no self-scrape (Vergilius uses Spring Boot + MySQL +
`wget --mirror`; we don't). `{module, arch, build, family}` are first-class in the
JSON and the URL.

## Build

```sh
(cd web && pnpm install)           # once; uses web/.npmrc + run bins directly (see below)
python3 tools/build.py            # reads data/sources.json, writes JSON, builds web/dist
python3 tools/build.py --skip-render   # data only
(cd web && ./node_modules/.bin/astro build && ./node_modules/.bin/astro preview)
```

Call the Astro binary directly rather than `pnpm build`: pnpm 11's pre-script
deps-verify re-runs install and fails on the (blocked) esbuild/sharp build scripts.
Full build is ~11 s / ~770 MB for ~24.7k pages. Watch for pathological types (e.g.
`_MI_HYPER_SPACE` is 276 MB) — anything that scales with struct *size* rather than
member count will blow the heap.

Manifest entries (`data/sources.json`) are one of:
- `{"pdb": "...", "module","arch","build","family"}` — a local PDB (most portable; this
  is how others add builds they have).
- `{"pe": "...", ...}` — a local PE; the matching PDB is fetched from msdl.
- `{"iso": "...", "arch","build","family", "modules":[...]}` — extract the module PEs
  from the install image, then fetch PDBs. Needs `7z` + `wimlib` (optional path).

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
- **Manifest `build` labels are cosmetic** — the correct PDB is resolved from the PE's
  RSDS GUID, so an approximate build string only affects the displayed label/URL.
- **A type is "documented" only if its PDB record has a real field list** (not a
  forward-ref). ntdll and ntoskrnl PDBs are complementary: each defines what it owns
  and forward-declares the other's types (e.g. `_TP_POOL` is full in ntdll, opaque in
  ntoskrnl). Opaque types render as plain (unlinked) names.
- **Anonymous unions are currently rendered sequentially** with offset comments, not
  wrapped in `union {}`/nested `struct {}`. Bitfields *are* handled. Porting
  Vergilius's offset-collision grouping (`FieldBuilder.getFirstPieceOfStruct`) is the
  main open rendering task — needed before `_PEB`/`_TEB`/`_KTHREAD` read perfectly.

## Don't

- **Don't commit PDBs or PEs** (`*.pdb` gitignored; they're large and
  redistribution-dubious). The committed artifact is the derived `data/*.json`.
- **Don't commit `web/dist/`** (generated).
- `web/vendor/verg.css` (original) + `web/public/assets/dracula.css` are **lifted from the Vergilius Project** and
  are © its authors — keep the attribution in README; a project LICENSE is still TODO
  (owner's choice).

## Status

See `PLAN.md` (single source of truth for open work). Notable known gaps: anonymous
unions render flat; `PTR = 8` is hardcoded in render.mjs (x86 needs arch-aware sizes);
module labels are hardcoded to ntdll/ntoskrnl.
