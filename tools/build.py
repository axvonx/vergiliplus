#!/usr/bin/env python3
"""Batch driver: a manifest of Windows versions -> JSON type data -> static site.

Covers BOTH kernel (ntoskrnl) and userland (ntdll, ...) across many builds — the
point being to document versions Vergilius misses (canary/insider/server), not just
released kernels.

Manifest (data/sources.json) is a list of entries. Three source kinds:

  {"pdb": "path/ntkrnlmp.pdb", "module":"ntoskrnl", "arch":"x64",
   "build":"10.0.26100.7824", "family":"Windows 11 24H2"}

  {"pe":  "path/ntoskrnl.exe", ...}            # fetch matching PDB from msdl first

  {"iso": "path/win7.iso", "arch":"x64", "build":"6.1.7601", "family":"Windows 7 SP1",
   "modules":["ntoskrnl","ntdll"]}             # mount, extract each module's PE, fetch PDB

Each entry yields data/<module>-<build>-<arch>.json; then the Astro site in web/
renders the lot into web/dist/.
Run: python3 tools/build.py [manifest.json] [--skip-render]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
# where a module's PE lives inside a Windows image / on the running system
PE_IN_IMAGE = {
    "ntoskrnl": "Windows/System32/ntoskrnl.exe",
    "ntdll": "Windows/System32/ntdll.dll",
}


def tool(*names):
    """First available executable among names, or None."""
    for n in names:
        if shutil.which(n):
            return n
    return None


def run(cmd, **kw):
    print("  $ " + " ".join(cmd), file=sys.stderr)
    return subprocess.run(cmd, check=True, **kw)


def pdbid(pe):
    out = subprocess.run([sys.executable, "-I", os.path.join(HERE, "pe_pdbid.py"), pe],
                         capture_output=True, text=True, check=True).stdout
    return dict(line.split("=", 1) for line in out.splitlines())


def fetch_pdb(pe, outdir):
    out = run([os.path.join(HERE, "fetch_pdb.sh"), pe, outdir],
              capture_output=True, text=True)
    return out.stdout.strip().splitlines()[-1]


def make_json(pdb, module, arch, build, family, out):
    run([sys.executable, "-I", os.path.join(HERE, "pdb_to_json.py"), pdb,
         "--module", module, "--arch", arch, "--build", build,
         "--family", family, "-o", out])


def json_name(module, build, arch):
    return os.path.join(DATA, "%s-%s-%s.json" % (module, build, arch))


def extract_from_iso(iso, modules, workdir):
    """Pull each module's PE out of an install image inside the ISO.

    Portable (no mount, no root): 7-Zip reads the ISO9660 filesystem to get
    sources/install.{wim,esd}, then wimlib extracts the PE(s) from that image
    (wimlib handles both WIM and solid ESD). Returns {module: pe_path}.
    """
    sevenzip = tool("7z", "7zz", "7za")
    wimlib = tool("wimlib-imagex", "wimextract")
    if not sevenzip:
        raise RuntimeError("need 7-Zip (7z/7zz) for ISO extraction; "
                           "install p7zip, or add a 'pdb'/'pe' manifest entry instead")
    if not wimlib:
        raise RuntimeError("need wimlib (wimlib-imagex) for ISO extraction; "
                           "`brew install wimlib` / `apt install wimtools`")

    # 1) ISO -> install.wim|esd  (7z extracts just that path)
    for wimname in ("install.wim", "install.esd"):
        r = subprocess.run([sevenzip, "e", iso, "sources/" + wimname,
                            "-o" + workdir, "-y"],
                           capture_output=True, text=True)
        wim = os.path.join(workdir, wimname)
        if r.returncode == 0 and os.path.exists(wim):
            break
    else:
        raise FileNotFoundError("no sources/install.{wim,esd} in " + iso)

    # 2) install image -> module PEs (image index 1; shared system binaries)
    paths = [PE_IN_IMAGE[m] for m in modules]
    run([wimlib, "extract", wim, "1", *paths,
         "--dest-dir=" + workdir, "--no-acls", "--nullglob"])
    os.remove(wim)  # reclaim the multi-GB image immediately
    return {m: os.path.join(workdir, os.path.basename(PE_IN_IMAGE[m]))
            for m in modules}


def handle(entry, pdbdir):
    arch = entry["arch"]
    build = entry["build"]
    family = entry.get("family", "")
    produced = []

    if "pdb" in entry:
        out = json_name(entry["module"], build, arch)
        make_json(entry["pdb"], entry["module"], arch, build, family, out)
        produced.append(out)

    elif "pe" in entry:
        pdb = fetch_pdb(entry["pe"], pdbdir)
        out = json_name(entry["module"], build, arch)
        make_json(pdb, entry["module"], arch, build, family, out)
        produced.append(out)

    elif "iso" in entry:
        modules = entry.get("modules", ["ntoskrnl", "ntdll"])
        with tempfile.TemporaryDirectory() as work:
            pes = extract_from_iso(entry["iso"], modules, work)
            for module, pe in pes.items():
                if not os.path.exists(pe):
                    print("  !! %s not found in image, skipping" % module,
                          file=sys.stderr)
                    continue
                try:
                    pdb = fetch_pdb(pe, pdbdir)
                except subprocess.CalledProcessError:
                    print("  !! no PDB on msdl for %s %s, skipping"
                          % (module, build), file=sys.stderr)
                    continue
                out = json_name(module, build, arch)
                make_json(pdb, module, arch, build, family, out)
                produced.append(out)
    else:
        print("  !! unknown entry: %r" % entry, file=sys.stderr)
    return produced


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", nargs="?", default=os.path.join(DATA, "sources.json"))
    ap.add_argument("--skip-render", action="store_true")
    args = ap.parse_args()

    entries = json.load(open(args.manifest))
    pdbdir = os.path.join(tempfile.gettempdir(), "vergiliplus-pdbs")
    os.makedirs(pdbdir, exist_ok=True)

    for i, entry in enumerate(entries, 1):
        tag = entry.get("family", "") or entry.get("build", "")
        print("[%d/%d] %s" % (i, len(entries), tag), file=sys.stderr)
        try:
            handle(entry, pdbdir)
        except Exception as e:
            print("  !! FAILED: %s" % e, file=sys.stderr)

    if not args.skip_render:
        # the Astro site in web/ reads every data/*.json itself (web/dist/)
        web = os.path.join(ROOT, "web")
        astro = os.path.join(web, "node_modules", ".bin", "astro")
        if not os.path.exists(astro):
            sys.exit("web/ deps missing: run `pnpm install` in web/ first")
        run([astro, "build"], cwd=web)


if __name__ == "__main__":
    main()
