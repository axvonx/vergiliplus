#!/usr/bin/env python3
"""Batch driver: a manifest of Windows versions -> JSON type data -> static site.

Covers BOTH kernel (ntoskrnl) and userland (ntdll, ...) across many builds — the
point being to document versions Vergilius misses (canary/insider/server), not just
released kernels.

Manifest (data/sources.json) is a list of entries. Source kinds:

  {"pe":  "path/ntoskrnl.exe", "module":"ntoskrnl", "arch":"x64",
   "family":"Windows 11 24H2"}                 # fetch matching PDB from msdl

  {"pdb": "path/ntkrnlmp.pdb", "module":"ntoskrnl", "arch":"x64",
   "build":"10.0.26100.7824", "family":"..."}  # local PDB; "build" required
                                               # unless a "pe" is given too

  {"iso": "path/win7.iso", "arch":"x64", "family":"Windows 7 SP1",
   "modules":["ntoskrnl","ntdll"]}             # 7z the install image out, wimlib the PEs

  {"wim": "path/install.wim", ...}             # an install image directly (VM stage dirs)

  {"uup": "path/UUPs", ...}                    # a UUP set: MetadataESD_*.esd + package
                                               # ESDs, resolved with wimlib --ref

  {"msdl": "ntdll.dll", "timestamp": N, "size": N, "sha256": "...", "version": "10.0.x.y",
   "module":"ntdll", "arch":"x64", "family":"..."}
                                               # the PE itself from the msdl binary store
                                               # (indexed by TimeDateStamp+SizeOfImage, see
                                               # winbindex.m417z.com) — needs no local files

  {"sym": "ntkrpamp.pdb", "guid": "37D328E3...", "age": 2, "version": "6.0.6001.18000",
   "module":"ntoskrnl", "arch":"x86", "family":"..."}
                                               # a public PDB straight from msdl by its RSDS
                                               # identity, for binaries msdl doesn't serve
                                               # (x86 Vista/7 kernels). "version" is the
                                               # shipped binary's FileVersion (the label)

  {"pkg": "https://.../w2k3_sp1_x86_symbols.zip", "sha256": "...",
   "member": ["Windows2003_sp1.x86.fre.rtm.symbols.exe", "symbols.cab", "ntkrpamp.pdb.exe"],
   "version": "5.2.3790.1830", "module":"ntoskrnl", "arch":"x86", "family":"..."}
                                               # a PDB inside an official symbol package
                                               # (msdl lacks it): download, check sha256,
                                               # then 7z out each member of the chain in turn.
                                               # PDB 2.0 (Windows 2000) is read by pdb_to_json

  {"lib": "https://archive.org/download/<item>/<image>/DDK/LIB/MIPS/FREE/LIBCNTPR.LIB",
   "sha256": "...", ["member": [...]], "machine": "mips", "build": "4.0.1381.1",
   "note": "NT 4.0 DDK ... LIBCNTPR.LIB type records", ["kdext": {"url", "sha256"}],
   ["buildLabel": "no build number"], ["incomplete": "why"],
   "module":"ntoskrnl", "arch":"mips", "family":"..."}
                                               # pre-PDB layouts (tools/legacy/): CodeView 4
                                               # type records of a COFF library's objects for
                                               # one machine, fetched like "pkg" (archive.org
                                               # serves single files inside disc images).
                                               # "build" is required (a sort key; buildLabel
                                               # is what shows when there is no real number);
                                               # "note" becomes the layouts' provenance line;
                                               # "kdext" cross-checks _EPROCESS/_ETHREAD
                                               # against the offsets that debugger extension
                                               # prints, and fails the entry on a mismatch

Build labels come from the binaries, not the manifest (A1): images use the image's
own Build.ServicePackBuild (e.g. 6.3.9600.17050), single PEs their FileVersion. An
explicit "build" overrides. Paths may use $VARS / ~ and are relative to the manifest;
the committed manifest roots everything at $VP_IMAGES.

Each entry yields data/<module>-<build>-<arch>.json; then the Astro site in web/
renders the lot into web/dist/.
Run: python3 tools/build.py [manifest.json] [--skip-render] [--only SUBSTR]
"""
import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

import pdb_to_json
import pe_pdbid
from legacy import cv4, kdext

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
# where a module's PE lives inside a Windows image / on the running system
# (only modules whose public PDBs carry types; see docs/module-survey.md)
PE_IN_IMAGE = {
    "ntoskrnl": "Windows/System32/ntoskrnl.exe",
    "ntdll": "Windows/System32/ntdll.dll",
    "fltmgr": "Windows/System32/drivers/fltMgr.sys",
    "ndis": "Windows/System32/drivers/ndis.sys",
}
MSDL = "https://msdl.microsoft.com/download/symbols/"


class Skip(Exception):
    """Entry can't be built here (missing source / tool); not a pipeline bug."""


def tool(*names):
    """First available executable among names, or None."""
    for n in names:
        if shutil.which(n):
            return n
    return None


def run(cmd, **kw):
    print("  $ " + " ".join(cmd), file=sys.stderr)
    return subprocess.run(cmd, check=True, **kw)


def resolve(p, base):
    """Expand ~ and $VARS, anchor relative paths at the manifest's directory."""
    out = os.path.expandvars(os.path.expanduser(p))
    if "$" in out:
        raise Skip("unset variable in path %r (set e.g. VP_IMAGES)" % p)
    out = os.path.join(base, out)
    if not os.path.exists(out):
        raise Skip("source not found: " + out)
    return out


def download(url, out):
    """GET url -> out (msdl redirects to a CDN; urllib follows it)."""
    print("  GET " + url, file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": "Microsoft-Symbol-Server/10.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(out, "wb") as f:
        shutil.copyfileobj(r, f)
    return out


def fetch_pdb(pe, outdir):
    """The PE's public PDB from msdl, by its RSDS identity (cached in outdir)."""
    info = pe_pdbid.extract(pe)
    if not info:
        raise RuntimeError("no RSDS CodeView record in " + pe)
    out = os.path.join(outdir, info["guid"] + str(info["age"]) + "-" + info["pdb"])
    if not os.path.exists(out):
        download(MSDL + info["sympath"], out + ".part")
        os.replace(out + ".part", out)
    return out


def fetch_pe(entry, outdir):
    """Download a PE from msdl by TimeDateStamp+SizeOfImage and verify its sha256."""
    name = entry["msdl"]
    out = download("%s%s/%08X%x/%s" % (MSDL, name, entry["timestamp"], entry["size"], name),
                   os.path.join(outdir, name))
    if entry.get("sha256"):
        with open(out, "rb") as f:
            got = hashlib.sha256(f.read()).hexdigest()
        if got != entry["sha256"].lower():
            # winbindex hashes the file as shipped in an update; msdl can serve a
            # differently-signed copy of the same build. Accept it only if it is the
            # FileVersion the entry expects.
            fv = pe_pdbid.file_version(out)
            if not entry.get("version") or fv != entry["version"]:
                raise RuntimeError("sha256 mismatch for %s: %s (FileVersion %s)" % (name, got, fv))
            print("  ~~ %s: sha256 differs from winbindex, FileVersion %s matches" % (name, fv),
                  file=sys.stderr)
    return out


def fetch_sym(entry, outdir):
    """A PDB from msdl by identity (name + GUID + age), cached like fetch_pdb."""
    name, guid, age = entry["sym"], entry["guid"].upper(), int(entry["age"])
    out = os.path.join(outdir, guid + str(age) + "-" + name)
    if not os.path.exists(out):
        download("%s%s/%s%X/%s" % (MSDL, name, guid, age, name), out + ".part")
        os.replace(out + ".part", out)
    return out


def fetch_pkg(entry, outdir, url_key="pkg"):
    """A PDB out of a symbol package: GET the archive, verify sha256, then unpack each
    name of "member" from the previous archive with 7z. Cached as one file in outdir.
    (Also any other pinned download: "lib" entries, their "kdext".)"""
    url, members = entry[url_key], entry.get("member", [])
    key = hashlib.sha256((url + "|" + "|".join(members)).encode()).hexdigest()[:16]
    out = os.path.join(outdir, "pkg-%s-%s" % (key, os.path.basename(
        (members[-1] if members else url).replace("\\", "/"))))
    if os.path.exists(out):
        return out
    sevenzip = tool("7z", "7zz", "7za")
    with tempfile.TemporaryDirectory() as work:
        cur = download(url, os.path.join(work, "pkg"))
        h = hashlib.sha256()
        with open(cur, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() != entry["sha256"].lower():
            raise RuntimeError("sha256 mismatch for %s: %s" % (url, h.hexdigest()))
        if members and not sevenzip:
            raise Skip("need 7-Zip (7z/7zz) to unpack " + url)
        for i, member in enumerate(members):
            step = os.path.join(work, "step%d" % i)
            subprocess.run([sevenzip, "e", "-y", "-o" + step, cur, member], check=True,
                           capture_output=True)
            cur = os.path.join(step, os.path.basename(member.replace("\\", "/")))
            if not os.path.exists(cur):
                raise RuntimeError("%s not found in %s" % (member, url))
        shutil.copyfile(cur, out + ".part")
        os.replace(out + ".part", out)
    return out


def json_name(module, build, arch):
    return os.path.join(DATA, "%s-%s-%s.json" % (module, build, arch))


def wimlib():
    w = tool("wimlib-imagex", "wimextract")
    if not w:
        raise Skip("need wimlib (wimlib-imagex) for image extraction; "
                   "`brew install wimlib` / `apt install wimtools`")
    return w


def wim_images(wim):
    """[{index, name, build, spbuild}] from `wimlib-imagex info`."""
    out = subprocess.run([wimlib(), "info", wim], capture_output=True, text=True,
                         check=True).stdout
    imgs = []
    for block in re.split(r"\n(?=Index:)", out)[1:]:
        f = dict(re.findall(r"^([A-Za-z ]+?):\s+(.*)$", block, re.M))
        imgs.append({"index": int(f["Index"]), "name": f.get("Name", ""),
                     "build": f.get("Build"), "spbuild": f.get("Service Pack Build")})
    return imgs


def pick_image(imgs):
    """The installable OS image: skip setup media / WinRE, take the first left."""
    for im in imgs:
        if not re.search(r"setup media|recovery", im["name"], re.I):
            return im
    return imgs[0]


def extract_from_wim(wim, modules, workdir, refs=None):
    """Pull module PEs out of a WIM/ESD. Returns ({module: pe_path}, image)."""
    im = pick_image(wim_images(wim))
    paths = [PE_IN_IMAGE[m] for m in modules]
    cmd = [wimlib(), "extract", wim, str(im["index"]), *paths,
           "--dest-dir=" + workdir, "--no-acls", "--nullglob"]
    if refs:
        cmd.append("--ref=" + refs)
    run(cmd)
    return ({m: os.path.join(workdir, os.path.basename(PE_IN_IMAGE[m])) for m in modules},
            im)


def extract_from_iso(iso, modules, workdir):
    """ISO -> sources/install.{wim,esd} (7-Zip reads ISO9660, no mount/root) -> PEs."""
    sevenzip = tool("7z", "7zz", "7za")
    if not sevenzip:
        raise Skip("need 7-Zip (7z/7zz) for ISO extraction; "
                   "install p7zip, or add a 'pdb'/'pe' manifest entry instead")
    for wimname in ("install.wim", "install.esd"):
        r = subprocess.run([sevenzip, "e", iso, "sources/" + wimname,
                            "-o" + workdir, "-y"],
                           capture_output=True, text=True)
        wim = os.path.join(workdir, wimname)
        if r.returncode == 0 and os.path.exists(wim):
            break
    else:
        raise FileNotFoundError("no sources/install.{wim,esd} in " + iso)
    try:
        return extract_from_wim(wim, modules, workdir)
    finally:
        os.remove(wim)  # reclaim the multi-GB image immediately


def extract_from_uup(uup, modules, workdir):
    """A UUP set: the edition's MetadataESD holds the image metadata, the package
    ESDs hold the file data; wimlib resolves them together with --ref."""
    metas = sorted(glob.glob(os.path.join(uup, "MetadataESD_*.esd")))
    if not metas:
        raise FileNotFoundError("no MetadataESD_*.esd in " + uup)
    return extract_from_wim(metas[0], modules, workdir,
                            refs=os.path.join(uup, "*.esd"))


def image_build(im, kernel_version):
    """One label per image, shared by all its modules (so module pairs line up):
    the image's Build.SPBuild under the kernel's major.minor (6.3 + 9600.17050).
    Some images (Server 2016) report SPBuild 0 — fall back to the kernel's own
    FileVersion then."""
    if not kernel_version:
        return None
    if not im.get("build") or im.get("spbuild") in (None, "0"):
        return kernel_version
    return "%s.%s.%s" % (".".join(kernel_version.split(".")[:2]), im["build"], im["spbuild"])


def handle(entry, base, pdbdir):
    arch = entry["arch"]
    family = entry.get("family", "")
    produced = []

    def emit(pdb, module, build, fv):
        if not build:
            raise Skip("no build label for %s: give \"build\" or a \"pe\"" % module)
        out = json_name(module, build, arch)
        pdb_to_json.write(pdb_to_json.convert(pdb, module, arch, build, family, fv), out)
        produced.append(out)

    if "msdl" in entry:
        with tempfile.TemporaryDirectory() as work:
            pe = fetch_pe(entry, work)
            fv = pe_pdbid.file_version(pe)
            emit(fetch_pdb(pe, pdbdir), entry["module"], entry.get("build") or fv, fv)
        return produced

    if "sym" in entry:
        fv = entry["version"]
        emit(fetch_sym(entry, pdbdir), entry["module"], entry.get("build") or fv, fv)
        return produced

    if "pkg" in entry:
        fv = entry["version"]
        emit(fetch_pkg(entry, pdbdir), entry["module"], entry.get("build") or fv, fv)
        return produced

    if "lib" in entry:
        build = entry["build"]
        doc = cv4.convert([fetch_pkg(entry, pdbdir, "lib")], entry["machine"], entry["module"],
                          arch, build, family, entry["note"])
        if entry.get("kdext"):
            ext = fetch_pkg(dict(entry["kdext"], member=[]), pdbdir, "url")
            ok, n, _, bad = kdext.check(doc, ext)
            if bad or not n:
                raise RuntimeError("%s disagrees with %s on %s" % (
                    entry["lib"], entry["kdext"]["url"], ", ".join(b[0] for b in bad) or "everything"))
            print("  kdext: %d/%d _EPROCESS/_ETHREAD offsets agree" % (ok, n), file=sys.stderr)
        for k in ("buildLabel", "incomplete"):
            if entry.get(k):
                doc[k] = entry[k]
        out = json_name(entry["module"], build, arch)
        pdb_to_json.write(doc, out)
        produced.append(out)
        return produced

    if "pdb" in entry or "pe" in entry:
        module = entry["module"]
        pe = resolve(entry["pe"], base) if "pe" in entry else None
        fv = pe_pdbid.file_version(pe) if pe else None
        pdb = resolve(entry["pdb"], base) if "pdb" in entry else fetch_pdb(pe, pdbdir)
        emit(pdb, module, entry.get("build") or fv, fv)
        return produced

    kinds = {"iso": extract_from_iso, "wim": extract_from_wim, "uup": extract_from_uup}
    kind = next((k for k in kinds if k in entry), None)
    if not kind:
        print("  !! unknown entry: %r" % entry, file=sys.stderr)
        return produced
    src = resolve(entry[kind], base)
    modules = entry.get("modules", ["ntoskrnl", "ntdll"])
    with tempfile.TemporaryDirectory() as work:
        pes, im = kinds[kind](src, modules, work)
        versions = {m: pe_pdbid.file_version(p) for m, p in pes.items() if os.path.exists(p)}
        label = entry.get("build") or image_build(
            im, versions.get("ntoskrnl") or next(iter(versions.values()), None))
        for module, pe in pes.items():
            if not os.path.exists(pe):
                print("  !! %s not found in image, skipping" % module, file=sys.stderr)
                continue
            fv = versions[module]
            try:
                pdb = fetch_pdb(pe, pdbdir)
            except urllib.error.HTTPError:
                print("  !! no PDB on msdl for %s %s, skipping" % (module, fv),
                      file=sys.stderr)
                continue
            emit(pdb, module, label, fv)
    return produced


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", nargs="?", default=os.path.join(DATA, "sources.json"))
    ap.add_argument("--skip-render", action="store_true")
    ap.add_argument("--only", help="only entries whose source path or family contains this")
    args = ap.parse_args()

    entries = json.load(open(args.manifest))
    base = os.path.dirname(os.path.abspath(args.manifest))
    if args.only:
        entries = [e for e in entries if args.only in json.dumps(e)]
    pdbdir = os.path.join(tempfile.gettempdir(), "vergiliplus-pdbs")
    os.makedirs(pdbdir, exist_ok=True)

    produced, failed = [], 0
    for i, entry in enumerate(entries, 1):
        tag = entry.get("family", "") or entry.get("build", "")
        print("[%d/%d] %s" % (i, len(entries), tag), file=sys.stderr)
        try:
            produced += handle(entry, base, pdbdir)
        except Skip as e:
            print("  -- skipped: %s" % e, file=sys.stderr)
            failed += 1
        except Exception as e:
            print("  !! FAILED: %s" % e, file=sys.stderr)
            failed += 1

    if not args.only and not failed:
        # a full clean run defines data/: anything else there is from an old label
        keep = set(map(os.path.abspath, produced))
        for f in glob.glob(os.path.join(DATA, "*-*-*.json")):
            if os.path.abspath(f) not in keep:
                print("  stale (not produced by this run): %s" % os.path.basename(f),
                      file=sys.stderr)

    if not args.skip_render:
        # the Astro site in web/ reads every data/*.json itself (web/dist/)
        web = os.path.join(ROOT, "web")
        astro = os.path.join(web, "node_modules", ".bin", "astro")
        if not os.path.exists(astro):
            sys.exit("web/ deps missing: run `pnpm install` in web/ first")
        run([astro, "build"], cwd=web)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
