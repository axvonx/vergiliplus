# Module type survey (C1)

Which modules' public PDBs carry enough type information to be worth a listing.
Surveyed 2026-11-01 on **Windows 11 Canary 10.0.29680.1000 x64** (UUP set): each PE
extracted with `tools/build.py`'s `extract_from_uup`, PDB fetched from msdl, run
through `pdb_to_json.py`. "Unique" = named types not also defined by ntoskrnl/ntdll.

| module | PDB | named types | unique | C++ (`::`/`<>`) | JSON | verdict |
|---|---|---:|---:|---:|---:|---|
| ntoskrnl | ntkrnlmp.pdb | 2,151 | — | 0 | 3.1 MB | shipped |
| ntdll | ntdll.pdb | 771 | — | 0 | 1.3 MB | shipped |
| **ndis** | ndis.pdb | 1,873 | 1,507 | 646 | 2.3 MB | **add** — kernel networking internals, mostly unique |
| **fltmgr** | fltMgr.pdb | 401 | 122 | 0 | 0.6 MB | **add** — small; the `_FLT_*` filter-manager internals |
| combase | combase.pdb | 25,812 | 25,431 | 17,485 | 39.7 MB | defer — see below |
| kernelbase, kernel32 | | 0 | | | | public PDB is stripped of types |
| win32k, win32kbase, win32kfull | | 0 | | | | stripped |
| hal, ci, tcpip | | 0 | | | | stripped |

## Notes

- **Threshold.** Anything with a few hundred unique, C-shaped types earns a listing;
  stripped PDBs (types removed from the public symbol) have nothing to show.
- **Cost.** One page per type per build: ndis + fltmgr add ~2.3k pages (~25 MB) per
  build — about doubling `dist` at today's 13 builds (281 MB → ~560 MB), inside the
  600 MB budget in `tools/check_budget.py` but close. Decide on the budget first.
- **combase** is ~25k types per build, two thirds C++ (templates, WRL/COM classes).
  It would need a C++-aware renderer (base classes, vtables, template names in URLs)
  and on its own would exceed GitHub Pages' ~1 GB after ~10 builds. Not worth it as-is.
- Adding a module is a manifest change only: `"modules": ["ntoskrnl", "ntdll", "ndis",
  "fltmgr"]` on image entries (paths are in `PE_IN_IMAGE`), and a row in
  `web/src/lib/modules.mjs` (ring/label) — both already include these.
