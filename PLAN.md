# PLAN.md — vergiliplus: what's left

Trimmed 2026-11-02 after the x86 / IA-64 / pre-XP / ARM64 work landed (see CLAUDE.md for
the rules and `git log` for how). `$VP_IMAGES` = the disk-image root. Research tools and
inventories stay in `$VP_IMAGES/research/` (not in the repo).

## Settled policy (don't relitigate)

- Only material Microsoft itself published (symbol servers, Update Catalog, SDK/DDK/OS
  media, its debugger extensions), incl. archive.org mirrors of it pinned by hash. No
  leaked source. Every non-PDB layout shows its provenance; partial builds are marked
  `incomplete`; pre-release builds without a number show "no build number".

## Open leads

- **IA-64**: XP 64-bit / 2003 RTM (needs an RTM symbol package or media; archive.org
  `ti_win2k3` has only SP1/SP2 IA-64 symbols). 2008 R2: catalog updates ship only PA30
  deltas (needs msdelta); a 2008 R2 IA-64 ISO would do.
- **ARM64**: more builds via UUP (uupdump `get.php` lists files + sha1; the metadata ESD
  and `Microsoft-Windows-Client-Desktop-Required-Package.esd` suffice). ARM32 (Windows
  RT 8/8.1, W10 IoT/Mobile) not probed for media.
- **x86 Win10 1903 ISO** downloaded (`$VP_IMAGES/windows/x86/iso/`) but redundant: 1903 and
  1909 share the 18362 kernel, already built from the 1909 ISO. Delete if space matters.
- **K (lower value)**: NT 4.0 SP-era DDKs (`CDAC-131500`, April 1997) and NT 4.0 Beta 2
  DDK for more 4.0 builds; Win2000 Oct 2000 DDK (7z, not unpacked); other unstripped
  drivers in DDK/SDK DRVLIB. Dead ends (checked 2026-11-02): NT 3.1 retail CDs (builds
  511/528: no KDEXT, no field dumps in I386KD, zero types in .dbg/kernels); builds 311 and
  340.1 DDK (= the Oct 1992 DDK already scanned); no pre-4.0 `_KTHREAD` anywhere.
- More MIPS 1992-93: build 297 SDK's `USER32.DLL` and build 404's `DISKPERF.EXE` carry
  types too (same level; 404's two binaries disagree on `_PEB`, 112 vs 100 bytes). x86
  binaries of those media carry few types.
- MIPS NT 4.0 `_KPRCB`: CRASHLIB's MIPS object disagrees with the DDK (`_KTRAP_FRAME`
  512 vs 600), so none is shown; another source would be needed.

## Names without layouts (attested), next steps

- Done: checked kernels' ASSERT names for Oct 1991, 3.1 (511), 3.5, 3.51, 4.0 on every arch; SDK
  WINNT.H for ntdll Dec 1991 → 4.0; NT 3.1 kernel from the July 1994 MSDN DDK headers.
- Also done: NT 3.1 Alpha (528), 404.1's checked kernels (March 1993 DDK) and SDK
  (MDF), NT 4.0 Beta 2 (1314: x86/PPC LIBCNTPR.LIB records, MIPS/Alpha headers, checked
  kernels). April 1995 disc 5's "3.50.800.1" kernels are 3.5 RTM (807) checked again.
- Not yet: Beta 2's ntdll (its DDK ships WINNT.H without WINDEF.H; the Beta 2 SDK
  would do); drivers' names (NTFS.SYS, FASTFAT.SYS on the checked discs) belong to
  modules the site doesn't have yet.

## Facts that cost time to find

- NT 3.1 / 3.5 / 3.51 / 4.0 public `.dbg` symbols carry **zero** type records; kernel
  types before Win2000 SP3 exist only in DDK/SDK libraries and debuggers.
  The 4.0 checked build's `.DBG` files carry none either. The NT 3.1 DDK's libraries
  (July 1994 MSDN disc 2, `DDK/LIB/*/CHECKED`) are import libraries: no `.debug$T`.
- Raw CD images (BIN 2352-byte, MDF 2448-byte sectors) convert to ISO with
  `legacy/rawcd.py`; images unpacked by several entries download once
  (`$TMPDIR/vergiliplus-pdbs/dl-<sha256>`).
- NT 3.x setup media compress binaries two ways: `.EX_` is SZDD on 3.1 (`szdd` member
  step) and a one-file CAB on 3.5/3.51 (7z reads it).
- NT 3.1's kernel FileVersion reads 3.10.5098.1; `NtBuildNumber`'s initial value
  (0xF00001FF = 511) is the build. Search the image for 0xF0000000 | build.
- Win2000 public kernel PDBs: RTM/SP1/SP2 empty TPI; SP3/SP4/UR1 full.
- DDK CABs store renamed members (`*_FILE_n`); the `.INF` next to each CAB maps names.
- Update Catalog: `Search.aspx?q=…` (send a browser User-Agent), then POST
  `DownloadDialog.aspx` with `updateIDs=[{"size":0,"languages":"","uidInfo":ID,"updateID":ID}]`;
  the SHA-1 is the file name's hex suffix. Service-pack self-extractors append the payload
  CAB after the stub: find the largest `MSCF` and carve it in Python.
- archive.org serves single files inside ISO/ZIP images (`/download/<item>/<image>/<path>`),
  but not inside High Sierra images (503): fetch the whole image, read it with
  `tools/legacy/hsfs.py`.
- msdl's TimeDateStamp+SizeOfImage key collides for ntdll (1803, 1809 x86): it serves a
  later revision with the same PDB GUID; pin what it serves.
