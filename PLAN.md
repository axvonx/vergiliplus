# PLAN.md — vergiliplus: x86 finish, then everything before XP (and 1991)

Self-contained hand-off, written 2026-11-02 (01:30 EST) at the end of a long session.
Read CLAUDE.md first; this file assumes its rules. Delete this file (or trim it to what's
left) as items land. `$VP_IMAGES` = the disk-image root (see local memory / your shell).

## 0. Where things stand

**`main` (deployed, vergiliplus.com):** x64 only, 22 builds (XP x64 → Canary).
One page per arch × module × type at `/t/<arch>/<module>/<slug>.html#<build>`, per-type
gzipped packs at `/p/...json.gz`, member search in the palette. dist 38.6 MB / 7,846 files.

**Branch `x86` (pushed, NOT merged; worktree `.claude/worktrees/agent-a1006de21314aee4a`):**
4 commits (ba73f98 x86 XP→7, 2a3ef1f PDB 2.0 reader + Win2000 SP3/SP4/UR1, ab70327
palette names the arch, aeb946a CLAUDE.md). 17 new docs:
Win2000 SP3/SP4/SP4 UR1 (kernel only), XP SP1, XP SP3, 2003 SP1, 2003 SP2, Vista SP1,
Vista SP2, Win7 SP1. x86 kernel = PAE MP (`ntkrpamp.pdb`), module still `ntoskrnl`.
New manifest kinds: `sym` (PDB from msdl by GUID+age; Vista/7 PAE kernels aren't served
as PEs) and `pkg` (PDB inside an official symbol package, archive.org mirror, pinned by
sha256 + member chain). Re-verified on the final commit by the parent session: tests
17/17, build, check_links (0 broken), check_budget (49.8 MB / 10,782 files) all pass;
_EPROCESS sizes XP SP3 0x260, Win7 SP1 0x2c0, 2000 SP3/SP4 0x288 (= the Win2000 DDK,
independently), 2000 UR1 0x290 — all consistent with Vergilius / !processfields.
Known gaps: XP SP2 (public PDBs have zero type records → dropped), Win2000 ntdll
(stripped), no mangled-name opaque scan for PDB 2.0. CLAUDE.md scale numbers not updated.

**x86 ISOs downloaded and md5-verified against archive.org** (2026-11-02) in
`$VP_IMAGES/windows/x86/iso/`: Win8 RTM, 8.1 with Update, Win10 1507 (`.iso.xz`), 1607 N,
1703, 1809. Partial only (60–120 MB, not usable): 1709, 1803, 1903; 1909 not started.
Resume script: `$VP_IMAGES/research/tools/dl3.sh` (`curl -C -`; add the missing items'
archive.org URLs). Verify each with the item's `metadata/<id>/files` md5.

**Research results (persistent, not in the repo):** `$VP_IMAGES/research/`
- `tools/`: `cvscan.py` (CodeView inventory: COFF .lib/.obj `.debug$T`, .dbg NB05/09,
  PDB 2.0, PE-embedded CV; 16-bit, `_ST` and modern leaves; `--dump NAME`), `cv3.py`
  (CodeView 3 / NB02 reader), `cv3layout.py` (natural 32-bit relayout of 1-byte-packed
  CV3 structs), `kdfields.py` (recovers `!processfields`/`!threadfields` offsets from an
  i386 KDEXT*.DLL by `push imm; push fmt`), `hsfs.py` (High Sierra CD extractor),
  `tpi20.py`, `dbginspect.py`, `dbgdir.py`, `coffsyms.py`, `iaiso.py` (list files inside
  an archive.org disc image), `cdp.mjs` (headless Chrome via DevTools protocol; use it,
  `chrome-devtools-axi` was broken with "pageId undefined"), `dl3.sh`.
- `results/`: per-disc inventories (`lib-*.tsv`, `s-*.tsv`, `n-*.tsv`: file, member,
  machine, kind, name, size, nmembers), `1991/{oct1991-i386,apr1991-mips}.{json,txt}`
  (computed layouts with `hostOffset`), PCjs disk images `d1..3.img`.
- Media under `$VP_IMAGES/windows/`: `ntcd/` (NT 3.51 wks, NT 4.0 srv CDs), `ddk/`
  (NT 3.1 ×3, 3.5, 3.51, 4.0 DDKs, Win32 SDK 1996), `ddk2k/` (Win2000 DDK Beta3, RC2,
  final, Oct 2000), `nt31/` (Win32 SDK for NT 3.1, AXP build 438 SDK, Oct 1991 High
  Sierra CD, build 297 VMDK), `ia64-2003/`, `x86/`, `vista2008/`, `xp2003/`.

## 1. Settled policy (don't relitigate)

- Only material Microsoft itself published (symbol servers, Update Catalog, SDK/DDK/OS
  media, its debugger extensions), incl. archive.org mirrors of it pinned by hash.
  **No leaked source** (e.g. the NT 3.5 build 782 leak on GitHub): legal exposure, and
  it breaks "verifiable from published artifacts". We publish derived layout facts,
  never redistribute binaries/PDBs (README License section stays true).
- Every layout's provenance is shown when it isn't a public PDB (see §3.D).

## 2. Decisions for you (recommendation first)

1. **How to show non-PDB provenance.** Recommend a one-line badge in the context bar /
   panel ("from DDK library type records, cross-checked with KDEXTX86" / "computed
   layout: 1991 debugger types, natural alignment") + a field in the doc JSON.
2. **Build labels for pre-release 1991 builds** (no FileVersion exists). `cmpBuild`
   sorts numerically on 4 dot parts. Recommend `0.1991.4.0` (April) / `0.1991.10.0`
   (October) with families "NT pre-release, Apr 1991 (MIPS)" / "… Oct 1991 (x86)". Needs
   an exception to the "labels come from binaries" rule; document it in CLAUDE.md.
3. **Partial data (NT 3.5/3.51):** typed user-mode structs only + names/offsets of
   EPROCESS/ETHREAD from kdext. Recommend: include the typed structs as normal builds;
   skip the names-only view (or a later "offsets only" panel kind).
4. **Fix `.gitattributes`:** `data/*.json -diff` also hides diffs of the hand-edited
   manifest — add `data/sources.json diff` after it. (This is why git shows it as "Bin".)

## 3. Work, in dependency order

Critical path: A → D → E → F/G/H. B, C, J run in parallel with D.

### A. Merge `x86` (≈30 min)
Review the diff (22 files) like code; it already passes the gates. Merge to main
(fast-forward or merge commit), push, confirm CI. Then `git worktree remove
.claude/worktrees/agent-a1006de21314aee4a`, `git branch -d worktree-agent-…` if present.
Update CLAUDE.md's build count and Scale paragraph after B.

### B. Finish x86 Win8 / 8.1 / 10
For each ISO: extract ntoskrnl.exe + ntdll.dll (wimlib-imagex/7z), read
TimeDateStamp/SizeOfImage/sha256/FileVersion (`tools/pe_pdbid.py`), verify msdl serves a
byte-identical PE, add an `msdl` entry (line-by-line manifest edit). Win8+ is PAE-only
(ntoskrnl.exe). Win10 22H2 x86 is already extracted; pins:
- ntoskrnl 10.0.19041.3803: timestamp 3249680249, size 7819264,
  sha256 57bac0d6da35e6eb2155fad0eafc771e6dc07583ec4bb53730af168e1206abab
- ntdll 10.0.19041.3636: timestamp 1835316653, size 1699840,
  sha256 a501a2888db6561efed1fc3f85481ba3aaccd2ef2d663e8675963077e4e0dafe
(Pin both modules of a build to one revision where possible — here they differ; note it.)
Cross-check a couple vs vergiliusproject.com x86 pages. ~7–8 MB dist per build pair.

### C. IA-64 (Itanium)
Proven: 2003 SP2 IA-64 package (Update Catalog,
`windowsserver2003-kb914961-sp2-ia64-enu_8856af0a…exe`, saved in
`$VP_IMAGES/windows/ia64-2003/`); `ia64/ntkrnlmp.exe` → PDB on msdl
`ntkrnlmp.pdb/A7B3822D37B4482B919272464F6477902`; converts to 553 named types
(_EPROCESS 0x400, _CONTEXT 0xa70). PTR_SIZE falls back to 8 (add `ia64: 8`). Add msdl
entries for kernel + ntdll (`ntdll.pdb/3DEB4221AA5746E9BFADBBF7B7C4D7A91`) if msdl serves
the PEs, else `sym`. Then: XP 64-bit, 2003 RTM/SP1, 2008 / 2008 R2 IA-64 via catalog SPs.

### D. Legacy-types converter (the core new code)
Move the research readers into `tools/legacy/` (stdlib only) and make them emit the
**same doc JSON** `pdb_to_json.convert()` emits (types keyed by hex index; kinds
struct/union/enum/pointer/array/modifier/bitfield/procedure/base/fieldlist; `named`,
`opaque`), plus `doc.provenance = {kind, note}`. Three inputs:
1. **CV4 in COFF libraries/objects** (`.debug$T`, sig 1/2/4): 16-bit leaves (0x0001…
   0x0007, 0x0204 fieldlist, 0x0406 member, 0x0206 bitfield) and 32-bit `_ST` leaves
   (0x1001…0x1007, 0x1203, 0x1405, 0x1205). Each archive member's table is separate
   (type indices restart at 0x1000 per object): merge by struct name, prefer the
   definition with the most members, and check duplicates agree (they should).
2. **CV3 (NB02)** from NE executables (1991 kernel debuggers) + the natural relayout in
   `cv3layout.py` (keep `hostOffset` for audit; flags: 2-byte signed ints may have been
   16-bit-host `int` → 4 in the kernel; validated so far as genuine SHORTs).
3. (already done on `x86`) PDB 2.0 via `parse20()`.
New manifest kind, e.g. `"lib"`: `{lib: {item, image, path[, member chain]}, sha256,
machine: "mips", module: "ntoskrnl", arch, family, build}` — `item` = archive.org id,
`image` = disc image name, `path` inside (CAB-renamed files: map names via the CAB's
`.INF`, e.g. `x86dLIBf_FILE_24` = libcntpr.lib), `machine` = COFF machine to keep
(0x14c i386, 0x166 MIPS, 0x184 Alpha, 0x1f0 PPC). Golden fixtures: add one legacy doc
(small) to `tests/golden/` so the converter has a spec.

### E. New arches: `mips`, `alpha`, `ppc` (32-bit pointers on NT, incl. Alpha)
`PTR_SIZE` entries = 4. Home page / palette already name the arch when >1 (from `x86`).
Check `/t/<arch>/` trees, builds.json keys, palette version list with 5–6 arches.

### F. NT 4.0 on i386, MIPS, Alpha, PPC (verified)
- Types: NT 4.0 DDK (archive.org `msdn-disc5-august-1996-0896-partno-92914`,
  `WINNTDDK.ISO`) → `DDK/LIB/<I386|MIPS|ALPHA|PPC>/FREE/LIBCNTPR.LIB`: ~160–190 named
  types per arch (_EPROCESS, _ETHREAD, _KPROCESS, _KTHREAD, dispatcher objects, _KAPC,
  _KDPC, _KINTERRUPT, _KTRAP_FRAME, _HANDLE_TABLE, _MMSUPPORT, _ERESOURCE, _DEVICE_OBJECT,
  _IRP, _PEB, …). i386 _EPROCESS 0x1F8 (= Chappell), Alpha 0x1E8, MIPS 0x1E8, PPC 0x1F0.
- Extra: Win32 SDK 1996 (`msdn-disc2-premium-release-0296-partno-69978`, `1_WIN32SDK.iso`)
  `MSTOOLS/SAMPLES/SDKTOOLS/IMAGE/DRWATSON/I386/CRASHLIB.LIB`: _KPRCB, _CONTEXT,
  _KTRAP_FRAME variants for **all four** arches inside one i386 lib — assign each variant
  to its arch by matching sizes to LIBCNTPR's per-arch types (_CONTEXT 204/560/568/464,
  _KTRAP_FRAME 140/512/600/320 = i386/alpha/mips/ppc); _KPRCB has 4 sizes (864, 1160,
  1288, 2184) — map with care, or skip if ambiguous.
- Verification (done): KDEXT{X86,ALP,MIP,PPC}.DLL from NT 4.0 Server CD
  (`nt-40-srv-en`, `NT40SRV_EN.ISO`, `SUPPORT/DEBUG/I386/`) `!processfields`: **58/58
  _EPROCESS offsets match on all four arches** (`kdfields.py` + `cvscan.py --dump`).
  Re-run as a test in the converter's checks.
- Build label: FileVersion of the NT 4.0 CD kernel (4.0.1381.x; extract
  `I386/NTOSKRNL.EX_` and the RISC kernels, read FileVersion). Note: DDK of Aug 1996 =
  NT 4.0 RTM; confirm against the CD kernel's offsets (kdext already agrees).

### G. Windows 2000 RC2 (i386 + Alpha) and RTM (i386) (verified)
- RTM: Win2000 DDK final (`msdn-disc7-february-2000-x05-48786`, `1_WIN2KDDK.iso`)
  `CABS/I386/X86DLIBF.CAB` member `x86dLIBf_FILE_24` = libcntpr.lib: ~400 named types;
  _EPROCESS 0x288 matches Microsoft's documented Win2000 `!processfields` example on
  every listed field (ExitStatus 0x6c, UniqueProcessId 0x9c, ActiveProcessLinks 0xa0,
  Token 0x12c, Peb 0x1b0, ImageFileName 0x1fc) and the SP3/SP4 PDB size. Label 5.0.2195
  (RTM; take FileVersion from an RTM kernel if one can be sourced, else document).
  This fills Win2000 RTM, whose own PDBs have empty type streams (RTM/SP1/SP2 stripped).
- RC2: `Windows2000DDKrc2betax86alpha` (`…/Disc02/Disc01.iso`), `CABS/I386/X86DLIBF.CAB`
  and `CABS/ALPHA/ALPDLIBF.CAB` `*_FILE_24`: ~400 types per arch, incl. Alpha _KPCR
  (5392) — the last NT ever built for Alpha. Build number of RC2 still to determine
  (RC2 = 2128 per public history; confirm from the DDK, e.g. its headers' ntverp or
  binaries' FileVersion).
- Not yet unpacked: Oct 2000 edition DDK (7z inner layout); Beta 3 DDK had no types.

### H. 1991 (computed layouts; label them as such — §2.1, §2.2)
- **April 1991, MIPS (Jazz)**: PCjs, commit 745b046 in `jeffpar/pcjs-miscdisks`,
  `pcx86/pcjs/jeffpar/JEFFPAR-WOW-REVERSI-MIPS-DISK{1,2,3}.json` (PCjs sector JSON:
  `diskData[cyl][head][sec].d` = int32 LE words, short arrays padded with the last
  word) → FAT 1.2 MB images → `NT.ZIP` → `MIPSKD.EXE` (and older `KD.EXE`): OS/2 NE
  with CodeView NB02. 50 structs: MIPS _CONTEXT (0x130, = NT 3.1 SDK's), _EXCEPTION_RECORD
  (0x24, ExceptionInformation[4]), _LIST_ENTRY, _STRING, _RUNTIME_FUNCTION, _DBGKD_*,
  _KD_PACKET*, _ENTRYLO/_ENTRYHI, _COFF_* (pre-PE). Kernel itself: MIPS ECOFF, publics only.
- **October 1991, i386**: archive.org `windows-nt-3.1-october-1991-build_202607`
  (High Sierra CD → `hsfs.py`), `SETUP/DBUGDISK/I386KD.EXE`: 85 structs incl. _KPCR,
  _KPRCB, _KTSS, _KPROCESSOR_STATE, _KSPECIAL_REGISTERS, _MMPFN/_MMPFNENTRY, _KDPC,
  _KIPI_*, _KGDTENTRY/_KIDTENTRY, _NT_TIB, _CONTEXT/_FLOATING_SAVE_AREA, early PE
  (_IMAGE_HEADER, _IMAGE_OBJECT_HEADER).
- The debuggers were compiled 1-byte packed for a 16-bit host; `cv3layout.py` recomputes
  natural 32-bit layouts (pointers 4, natural alignment). Validated: Oct 1991 _KPCR
  matches Chappell's NT 3.10 offsets on every shared member (NtTib 0, SelfPcr 0x1C,
  Prcb 0x20, Irql 0x24, IRR **0x28** — host 0x25); _KDPC natural 0x20 = NT 4.0's _KDPC
  size and positions. Only _KPCR (13 members) and _KPRCB (9) move; tails pad elsewhere.
- No _EPROCESS/_KTHREAD exists in any 1991 artifact found.

### I. (optional) NT 3.5 / 3.51 user-mode structs
Typed i386 _TEB, _PEB (3.5: 112, 3.51: 152 bytes), _PEB_LDR_DATA,
_RTL_USER_PROCESS_PARAMETERS, _CONTEXT from `GDISRVL.LIB`/`LIBCNTPR.LIB` in the 3.5 DDK
(`msdn-premium-release-1994-NT3.5`, `WINNT_DDK.iso`) and 3.51 DDK
(`msdn-platform-1995-disc3of3-final-release`, `nt351ddk.iso`). Module: ntdll-ish user
structs — decide which module they live under (probably `ntdll`). 3.51 kdext (NT 3.51
CD `en_winnt_3.51.wks_202604`, `SUPPORT/DEBUG/I386/KDEXT*.DLL`) gives 99 EPROCESS/ETHREAD
names+offsets for i386/MIPS/Alpha/PPC; ≈ NT 4.0's (10 entries differ).

### J. ARM64 / ARM32 probe
Not probed. ARM64: Win10 1709+ / Win11 (UUP or catalog); ARM32: Windows RT 8/8.1,
W10 Mobile/IoT. Same PDB 7 format; just sourcing + PTR_SIZE `arm: 4` exists.

### K. Remaining leads (lower value)
NT 4.0 SP-era DDKs (`CDAC-131500`, April 1997) and NT 4.0 Beta 2 DDK (bin/cue) for more
4.0 builds; NT 3.1 retail CD (`winnt-as-511`/`-528`) KDEXT offsets; Win2000 Oct 2000 DDK;
other unstripped drivers in DDK/SDK DRVLIB (NT 3.1 SDK's `4MMIBM.SYS` had CV types).

## 4. Facts that cost time to find

- NT 3.1 / 3.5 / 3.51 / 4.0 public `.dbg` symbols: **zero** type records anywhere (6,151
  files scanned on the 3.51 and 4.0 CDs, all four arches; NT 4.0 checked-build symbols
  too). Kernel types before Win2000 SP3 exist only via DDK/SDK libraries and debuggers.
- Win2000 public kernel PDBs: RTM/SP1/SP2 empty TPI; SP3/SP4/UR1 full (~315 structs).
- DDK CABs store renamed members (`*_FILE_n`); the `.INF` next to each CAB maps names.
- Update Catalog: search `Search.aspx?q=…`, then POST `DownloadDialog.aspx` with
  `updateIDs=[{"size":0,"languages":"","uidInfo":ID,"updateID":ID}]`; the SHA-1 is the hex
  suffix of the file name. Self-extractors may append the payload CAB after the stub:
  find `MSCF` and carve with Python (never `dd bs=1`).
- msdl serves pre-XP binaries/symbols only partially (Win2000 UR1 PE and .dbg: 404).
- archive.org can serve single files inside ISO/ZIP images
  (`/download/<item>/<image>/<path>`); ~1 MB/s per file, parallelize.
- macOS is case-insensitive: two names differing in case share a file (handled for
  pages; remember it for any new per-name files).
