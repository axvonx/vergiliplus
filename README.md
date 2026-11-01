# vergiliplus

A static browser of **authoritative Windows type layouts**: struct, union and enum
definitions taken from Microsoft's **public PDBs**. It covers **kernel (`ntoskrnl`)
and user-mode (`ntdll`)** across **13 builds**, from Windows 7 SP1 to Server 2025 and
the Canary channel, rendered pahole-style with offsets, sizes, padding and cachelines.

It started as the userland counterpart to the
[Vergilius Project](https://github.com/VergiliusProject/vergilius-project), which shows
only released kernels. `ntdll`'s PDB fully defines the thread pool (`_TP_POOL`,
`_TPP_*`), loader, heap and RTL structures. The kernel PDB only forward-declares them,
so Vergilius can't show them.

**Site:** vergiliplus.com (not yet live; see [Status](#status)).

## What you get

- **Every documented type in every build**, cross-linked: click a member's type to
  follow it, and see "Used in" back-references.
- **Real C shape.** Anonymous unions and structs are reconstructed from the PDB's flat
  field list, `<unnamed-tag>` members are inlined, and enums show value tables. You
  also get function-pointer signatures and bitfield bit positions (`/* 0x74:3  4 */`).
- **A Metadata toggle** for offset/size annotations, padding holes and cacheline
  boundaries, and a **copy** button that copies exactly what's shown.
- **A version bar:** a module switch (ntdll ↔ ntoskrnl), a build switcher that keeps
  you on the same type, and previous/next across the builds that define it.
- **⌘K search** over every type in every build, current context ranked first.

Coverage is what the public symbols contain, no more. A type appears only where its
PDB record has a real field list. For example, `_TP_POOL` is fully defined only from
build 26100 on, and ntdll's documented-type count grows from 331 (Win7) to 772 (Canary 29680).

| Family | Build | Source |
|---|---|---|
| Windows 7 SP1 | 6.1.7601.17514 | ISO |
| Windows 8 | 6.2.9200.16384 | ISO |
| Windows 8.1 | 6.3.9600.17415 | ISO |
| Windows Server 2012 R2 | 6.3.9600.17031 | ISO |
| Windows Server 2016 | 10.0.14393.693 | ISO |
| Windows Server 2019 | 10.0.17763.737 | ISO |
| Windows 10 22H2 | 10.0.19041.2006 ¹ | ISO |
| Windows Server 2022 | 10.0.20348.587 | ISO |
| Windows 11 21H2 | 10.0.22000.194 | ISO |
| Windows 11 24H2 | 10.0.26100.7824 | msdl |
| Windows Server 2025 | 10.0.26100.32230 | ISO |
| Windows 11 Canary | 10.0.28000.3231 | msdl |
| Windows 11 Canary | 10.0.29680.1000 | UUP |

All x64, each with both ntoskrnl and ntdll. ¹ 22H2 is an enablement package on top of
19041, and its binaries say so; build labels always come from the binaries.

## How it works

```
source (ISO / WIM / UUP set / msdl / local PE or PDB)
  ─ tools/build.py ─▶ module PEs ─ pe_pdbid.py ─▶ RSDS GUID + FileVersion
  ─ fetch_pdb.sh ─▶ <module>.pdb (Microsoft symbol server)
  ─ pdb_to_json.py (llvm-pdbutil dump -types) ─▶ data/<module>-<build>-<arch>.json
  ─ web/ (Astro) ─▶ web/dist/ (static HTML)
```

There's no server, no database and no scraping. The committed artifact is the derived
`data/*.json`. PDBs and binaries are never committed. `{module, arch, build}` are
first-class in the data and in the URL:
`/v/<arch>/<build>/<module>/<Type>.html`.

| Path | What |
|---|---|
| `tools/build.py` | Batch driver over the manifest `data/sources.json` |
| `tools/pe_pdbid.py` | PE → PDB identity (RSDS GUID/age) + `VS_FIXEDFILEINFO` FileVersion |
| `tools/fetch_pdb.sh` | Download a PE's public PDB from msdl |
| `tools/pdb_to_json.py` | `llvm-pdbutil` type dump → normalized JSON type graph |
| `tools/check_links.py`, `tools/check_budget.py` | Post-build gates: internal links, `dist` size |
| `web/src/lib/render.mjs` | Type → C renderer, layout reconstruction, cross-build catalog |
| `web/src/lib/modules.mjs` | Module table (ring + label) |
| `web/public/assets/nav.js`, `struct.js` | All client behaviour (sidebar, ⌘K, struct view); no framework |
| `tests/` | Golden tests over the renderer (`tests/golden/*.txt`) |
| `data/` | Committed type data + the manifest |
| `docs/module-survey.md` | Which other modules' public PDBs are worth adding |

## Building

**Requirements:** Python 3 (stdlib only), `llvm-pdbutil` (LLVM), `curl`, Node 22+ and
pnpm. Image sources also need `wimlib`, and ISOs additionally need 7-Zip:
`brew install llvm wimlib p7zip` / `apt install llvm wimtools p7zip-full`. No mounts,
no root, no hardcoded paths; tools are found via PATH (or `$LLVM_PDBUTIL`).

```sh
(cd web && pnpm install)
(cd web && pnpm test && pnpm build && pnpm preview)   # site from the committed data
python3 tools/check_links.py && python3 tools/check_budget.py
```

Regenerating data from sources:

```sh
export VP_IMAGES=/path/to/disk-images    # root for the ISO/UUP paths in the manifest
python3 tools/build.py --skip-render     # all entries;  --only <substring> for one
```

### Adding a build

`data/sources.json` is a list of entries. Paths expand `$VARS` and `~` and are relative
to the manifest. Build labels are derived automatically; a `"build"` key overrides.

```jsonc
// The PE straight from Microsoft's binary store. Needs no local files.
// timestamp/size/sha256 for a given file version are on winbindex.m417z.com.
{"msdl": "ntdll.dll", "timestamp": 3242245876, "size": 2523136, "sha256": "2b7c…",
 "module": "ntdll", "arch": "x64", "family": "Windows 11 24H2"}

// An install ISO, a WIM/ESD, or a UUP set (MetadataESD_*.esd + package ESDs)
{"iso": "${VP_IMAGES}/windows/win7/Win7_Ult_SP1_English_x64.iso", "arch": "x64", "family": "Windows 7 SP1"}
{"wim": "path/to/install.wim", "arch": "x64", "family": "…"}
{"uup": "${VP_IMAGES}/windows/canary/canary-uup/29680.1000/UUPs", "arch": "x64", "family": "Windows 11 Canary"}

// A PE or PDB you already have locally (a PDB alone needs an explicit "build")
{"pe":  "ntoskrnl.exe", "module": "ntoskrnl", "arch": "x64", "family": "…"}
{"pdb": "ntkrnlmp.pdb", "module": "ntoskrnl", "arch": "x64", "build": "10.0.26100.7824", "family": "…"}
```

Image entries extract `["ntoskrnl", "ntdll"]` by default. Pass `"modules"` for others
(paths are in `PE_IN_IMAGE` in `tools/build.py`). A new canary build is one `uup`
entry, or two `msdl` entries once winbindex indexes it.

## Status

- **Working:** everything above. 27.6k pages, `dist` ≈ 281 MB, ~10 s build. CI
  (GitHub Actions) runs the golden tests, the build, the link check (0 broken out of
  ~409k) and the size budget on every push.
- **Not live yet.** The repo is private, and GitHub Pages on a private repo needs a
  paid plan. DNS for vergiliplus.com already points at GitHub Pages. The deploy job
  turns on with the repo variable `PAGES_ENABLED=true` once Pages is available.
- **Next:** add `ndis` and `fltmgr` (see `docs/module-survey.md`), add x86 and ARM64
  builds (the renderer is arch-aware; it needs media), and decide on a cross-build
  diff view. The roadmap lives in [`PLAN.md`](PLAN.md).

## License

Code: [MIT](LICENSE). Exceptions: `web/vendor/verg.css` and the stylesheets adapted
from it in `web/public/assets/` (`vergiliplus.css`, `dracula.css`) are © the
[Vergilius Project](https://github.com/VergiliusProject/vergilius-project) authors,
under that project's terms. The type data in `data/` is derived from Microsoft's
public symbol server (layout facts extracted from public PDBs, as Vergilius does);
no PDBs or binaries are redistributed.
