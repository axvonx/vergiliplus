# vergiliplus

A **userland** type browser in the spirit of the [Vergilius Project](https://github.com/VergiliusProject/vergilius-project),
which documents only *kernel* (`ntoskrnl`) structures. This fills the gap Vergilius
leaves: the authoritative struct/union/enum layouts that Microsoft ships in the
**public PDBs of user-mode modules** — starting with `ntdll.dll`, whose PDB defines
the entire thread-pool family (`_TP_POOL`, `_TP_WORK`, `_TPP_*` …), the loader, heap,
RTL and activation structures. Those are opaque in `ntoskrnl.pdb` (the kernel only
forward-declares them), so Vergilius can't show them even though they're fully
documented in a PDB anyone can download.

## Why not just fork Vergilius

Vergilius is Spring Boot + MySQL + Pug, and it *scrapes its own running site* with
`wget --mirror` to publish static HTML. Its data model (`os`/`ttype`/`tdata`) keys
everything on `(buildnumber, arch)` — **one PDB == one "OS"**, with no module axis and
no cross-build diff concept. Its PDB→data extractor is **not** in the repo (the public
repo only ships the renderer + a separate `kernels-data` repo of pre-made YAML).

So vergiliplus keeps the two things worth keeping — the **look** (lifted CSS in
`web/public/assets/`, original in `web/vendor/verg.css`) and the **declaration-rendering model** (ported from its `FieldBuilder`)
— and drops the stack. The pipeline is just:

```
PE  ──pe_pdbid──▶ symbol-server path ──fetch_pdb──▶ <module>.pdb
    ──pdb_to_json (llvm-pdbutil)──▶ <module>-<build>-<arch>.json
    ──gen.py──▶ static site  (out/<arch>/<module>/<build>/)
```

No server, no DB, no self-scrape. `module`, `build`, and `arch` are first-class in the
JSON and the URL from day one — the thing Vergilius's schema can't express.

## Layout

| Path | What |
|------|------|
| `tools/pe_pdbid.py`   | Extract the RSDS PDB GUID/age from a PE → symbol-server path |
| `tools/fetch_pdb.sh`  | Download a module's public PDB from msdl |
| `tools/pdb_to_json.py`| `llvm-pdbutil dump -types` → normalized JSON type graph |
| `web/`                | Astro site (pnpm): reads every `data/*.json`, renders `web/dist/` |
| `web/src/lib/render.mjs` | type → C declaration renderer (the `FieldBuilder` analog) |
| `web/public/assets/`  | `vergiliplus.css` (adapted from Vergilius's `verg.css`) + `dracula.css` |
| `data/*.json`         | Committed derived type data (the `kernels-data` analog) |

## Build

The batch driver reads a manifest (`data/sources.json`) of builds and renders the lot:

```sh
python3 tools/build.py              # local PDBs + PEs + ISOs -> JSON -> site
(cd web && pnpm install && ./node_modules/.bin/astro build && ./node_modules/.bin/astro preview)
```

Manifest entries are portable and mix-and-match — **others add builds they have
locally** by dropping in a `pdb` entry; `pe`/`iso` entries are conveniences:

```jsonc
{"pdb": "ntkrnlmp.pdb", "module":"ntoskrnl", "arch":"x64", "build":"10.0.26100.7824", "family":"Windows 11 24H2"}
{"pe":  "ntdll.dll",    "module":"ntdll", ...}          // fetch matching PDB from msdl
{"iso": "win7.iso", "arch":"x64", "build":"6.1.7601", "family":"Windows 7 SP1"}  // extract ntoskrnl+ntdll
```

**Dependencies:** Python 3 (stdlib only) + `llvm-pdbutil` + `curl`. ISO entries also
need `7z` and `wimlib` (`brew install llvm p7zip wimlib` / `apt install llvm p7zip-full wimtools`).
Cross-platform — no mounts, no root, no hardcoded paths; tool discovery is via PATH/env.

## Status

Working end-to-end for **kernel + userland across 11 families** — Windows 7 SP1, 8,
8.1, 10 22H2, 11 (21H2 / 24H2 / Canary 28000 & 29680), and Server 2012 R2 / 2016 /
2019 / 2022 / 2025 — x64. ~24k cross-linked pages. Each page shows only types the
public PDB actually defines (forward-refs render as plain names), so coverage reflects
reality: e.g. `_TP_POOL`'s full layout appears only from build 26100 onward — older
public ntdll PDBs ship it opaque — and ntdll's documented-type count climbs 331 (Win7)
→ 712 (24H2) as Microsoft's public symbols grew richer.

Deliberately simple where Vergilius is elaborate — next steps, roughly in order:

- **Anonymous-union brace synthesis.** Overlapping non-bitfield members are currently
  rendered sequentially with offset comments (correct & readable, but not wrapped in
  `union {}` / nested `struct {}` the way `FieldBuilder.getFirstPieceOfStruct` does).
  Bitfields *are* handled. Needed before structs like `_PEB`/`_TEB` read perfectly.
- **"Used in" back-references** (Vergilius's `cros`) — invert the member graph.
- **Cross-build diff** — the JSON already carries `{module,arch,build}`; a diff view
  over two JSONs is a new consumer, not a schema change (Vergilius can't do this).
- **Scope survey** — most user DLLs ship PDBs with function symbols but few struct
  types; `ntdll` (and `kernelbase`) are the rich ones. Run `pdb_to_json` over
  candidates and keep the ones with a meaningful `named` count.

## License

Code: [MIT](LICENSE). Exceptions: `web/vendor/verg.css` and the stylesheets adapted
from it in `web/public/assets/` (`vergiliplus.css`, `dracula.css`) are © the
[Vergilius Project](https://github.com/VergiliusProject/vergilius-project) authors,
under that project's terms. The type data in `data/` is derived from Microsoft's
public symbol server (layout facts extracted from public PDBs, as Vergilius does);
no PDBs or binaries are redistributed.
