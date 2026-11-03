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
                                               # "format": "cv3" instead computes 32-bit
                                               # layouts from a 1991 debugger's CodeView 3;
                                               # "kdext": names+offsets only, from a debugger
                                               # extension. "names" limits what a cv4 doc
                                               # documents (what they reach comes along);
                                               # "namesRe" does it by a regex on the name.
                                               # "also": [{lib, sha256, [member]}] more files
                                               # read together; "variants": true keeps every
                                               # definition sources disagree on (labelled).
                                               # A "lib" may also be a PE image carrying its
                                               # CodeView 4 inline (MIPS 1992-93 binaries).
                                               # "supplement": {lib, sha256, [member], machine,
                                               # match: [names], take: [names], note} adds
                                               # "take" (+ what it reaches) from the one object
                                               # whose "match" structs agree with the doc's
                                               # (per-type provenance: its note)
                                               # "asserts": [{lib, sha256, [member]}] debug
                                               # builds whose ASSERT text names types
                                               # (tools/legacy/strnames.py): names without a
                                               # layout here become opaque, with evidence
                                               # (doc.attested)
                                               # "headers": {url | image, dirs, files, sha256,
                                               # [top], [only]}
                                               # a DDK's C headers (archive.org serves each
                                               # file of the image; sha256 pins the set:
                                               # sha256 of "<sha256>  <path>\n" per sorted
                                               # file), compiled by tools/legacy/headers.py
                                               # ("top" is #included; "only": [header] keeps
                                               # just the types those headers define, e.g. an
                                               # SDK's winnt.h out of windef.h).
                                               # On a lib entry: types the records lack are
                                               # added (provenanceTypes) after every header
                                               # member is found where the records have it.
                                               # Alone ({"headers", build, note, module,
                                               # arch, family, ...}): the build's doc (which
                                               # may carry "asserts" too).
                                               # "build" is required (a sort key; buildLabel
                                               # is what shows when there is no real number);
                                               # "cite" is the layouts' short provenance line
                                               # ("recorded in X, <release> DDK"), "note"
                                               # the long one (the build's sources panel);
                                               # "headers"/"supplement" carry their own;
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
import urllib.parse
import urllib.request

import pdb_to_json
import pe_pdbid
from legacy import cv3, cv4, headers, hsfs, kdext, pcjs, rawcd, strnames, szdd

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
    (Also any other pinned download: "lib" entries, their "kdext".) A member may instead
    be {"hsfs": path} (a file of a High Sierra CD image, which 7z can't read),
    {"pcjs": name} (a PCjs disk-image JSON -> its raw sector image), {"szdd": name}
    (the previous file expanded from COMPRESS.EXE's SZDD format, e.g. NTOSKRNL.EX_) or
    {"rawcd": name} (a raw BIN/MDF CD image -> a plain ISO)."""
    url, members = entry[url_key], entry.get("member", [])
    label = lambda m: m if isinstance(m, str) else json.dumps(m, sort_keys=True)
    key = hashlib.sha256((url + "|" + "|".join(map(label, members))).encode()).hexdigest()[:16]
    last = members[-1] if members else url
    last = last if isinstance(last, str) else next(iter(last.values()))
    out = os.path.join(outdir, "pkg-%s-%s" % (key, os.path.basename(last.replace("\\", "/"))))
    if os.path.exists(out):
        return out
    sevenzip = tool("7z", "7zz", "7za")
    with tempfile.TemporaryDirectory() as work:
        # an image several entries unpack (a DDK's libraries per arch) downloads once
        cached = os.path.join(outdir, "dl-" + entry["sha256"].lower()[:16]) if members else None
        cur = cached if cached and os.path.exists(cached) else download(url, os.path.join(work, "pkg"))
        h = hashlib.sha256()
        with open(cur, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() != entry["sha256"].lower():
            raise RuntimeError("sha256 mismatch for %s: %s" % (url, h.hexdigest()))
        if cached and cur != cached:
            shutil.copyfile(cur, cached + ".part")
            os.replace(cached + ".part", cached)
        if any(isinstance(m, str) for m in members) and not sevenzip:
            raise Skip("need 7-Zip (7z/7zz) to unpack " + url)
        for i, member in enumerate(members):
            step = os.path.join(work, "step%d" % i)
            os.makedirs(step)
            if isinstance(member, dict) and "hsfs" in member:
                nxt = os.path.join(step, os.path.basename(member["hsfs"]))
                with open(nxt, "wb") as f:
                    f.write(hsfs.extract(cur, member["hsfs"]))
            elif isinstance(member, dict) and "rawcd" in member:
                nxt = os.path.join(step, member["rawcd"])
                rawcd.convert(cur, nxt)
            elif isinstance(member, dict) and "szdd" in member:
                nxt = os.path.join(step, member["szdd"])
                with open(cur, "rb") as f, open(nxt, "wb") as g:
                    g.write(szdd.expand(f.read()))
            elif isinstance(member, dict) and "pcjs" in member:
                nxt = os.path.join(step, member["pcjs"])
                with open(cur) as f, open(nxt, "wb") as g:
                    g.write(pcjs.image(json.load(f)))
            else:
                subprocess.run([sevenzip, "e", "-y", "-o" + step, cur, member], check=True,
                               capture_output=True)
                nxt = os.path.join(step, os.path.basename(member.replace("\\", "/")))
            if not os.path.exists(nxt):
                raise RuntimeError("%s not found in %s" % (label(member), url))
            cur = nxt
        shutil.copyfile(cur, out + ".part")
        os.replace(out + ".part", out)
    return out


def fetch_headers(spec, outdir):
    """A pinned header set -> its include dirs (local, file names lower-cased: the
    sources #include them so), in spec order. Cached under outdir by the set's sha256.
    Files come one by one from spec["url"] (archive.org serves files inside ISO/ZIP
    images), or out of spec["image"] ({lib, sha256, member}: a whole image fetched like a
    "lib", e.g. a raw CD image via "rawcd", read with 7z)."""
    root = os.path.join(outdir, "hdr-" + spec["sha256"][:16])
    dirs = [os.path.join(root, "%d" % i) for i in range(len(spec["dirs"]))]
    if os.path.exists(root + ".ok"):
        return dirs
    shutil.rmtree(root, ignore_errors=True)
    for d in dirs:
        os.makedirs(d)
    image = fetch_pkg(spec["image"], outdir, "lib") if "image" in spec else None
    h = hashlib.sha256()
    for path in sorted(spec["files"]):
        local = os.path.join(dirs[spec["dirs"].index(os.path.dirname(path))],
                             os.path.basename(path).lower())
        if image:
            with tempfile.TemporaryDirectory() as w:
                subprocess.run([tool("7z", "7zz", "7za"), "e", "-y", "-o" + w, image, path],
                               check=True, capture_output=True)
                shutil.move(os.path.join(w, os.path.basename(path)), local)
        else:
            download(spec["url"] + "/" + urllib.parse.quote(path), local)
        with open(local, "rb") as f:
            h.update(("%s  %s\n" % (hashlib.sha256(f.read()).hexdigest(), path)).encode())
    if h.hexdigest() != spec["sha256"]:
        raise RuntimeError("sha256 mismatch for the header set at %s: %s"
                           % (spec.get("url") or spec["image"]["lib"], h.hexdigest()))
    open(root + ".ok", "w").close()
    return dirs


def merge_headers(doc, spec, pdbdir, listed=None):
    """Add the types a lib doc's records lack from its DDK's headers (see headers.merge),
    failing if any member the headers give sits elsewhere in the records. `listed`: the
    entry's "names", when it takes only those from the records; a type the records
    document only because a listed one reaches it yields to the headers' definition
    where that has members the record lacks (404.1's _PEB reaches _LARGE_INTEGER, whose
    1993 record drops the anonymous LowPart/HighPart struct)."""
    hdr = headers.convert(fetch_headers(spec, pdbdir), doc["arch"], doc["module"], doc["build"],
                          top=spec.get("top", "ntddk.h"), only=spec.get("only"))
    if listed is not None:
        leaves = lambda d, n: {(x[0].split(".")[-1],) + x[1:] for x in headers.flat(d, d["named"][n])}
        for n in [n for n in doc["named"] if n not in listed and n in hdr["named"]
                  and hdr["types"][hdr["named"][n]]["kind"] != "enum"
                  and leaves(hdr, n) - leaves(doc, n)]:
            del doc["named"][n]
            doc.get("variants", {}).pop(n, None)
    bad = headers.check(doc, hdr)
    if bad:
        raise RuntimeError("headers disagree with the records on %s" % ", ".join(
            "%s.%s" % (n, x[0]) for n, x in bad))
    shared = len(set(doc["named"]) & set(hdr["named"]))
    added = headers.merge(doc, hdr, spec["note"])
    print("  headers: %d shared types agree; %d added" % (shared, len(added)), file=sys.stderr)
    return "%d types the headers share with the records agree" % shared if shared else None


TAG = {"cv3": "debugger", "kdext": "offsets"}  # a "lib" entry's format -> its source tag


def cite_sources(doc, entry, checks):
    """doc.sources: [{tag, cite, note, url[, check]}] for the build's sources panel, and
    tag + cite (the short form a type page shows) on every provenance object. Tags:
    records (type records), debugger (1991 debuggers' CodeView 3), offsets (names and
    offsets from a debugger extension), headers (computed from C headers), names (ASSERT
    text). The manifest's "cite" is the short form, "note" the long one."""
    url = lambda x: x.get("lib") or x.get("url") or x["image"]["lib"]
    main = {"tag": TAG.get(entry.get("format"), "records") if "lib" in entry else "headers",
            "cite": entry["cite"], "note": entry["note"],
            "url": url(entry) if "lib" in entry else url(entry["headers"])}
    srcs, by_note = [main], {entry["note"]: main}
    h = entry.get("headers") if "lib" in entry else None
    if h and "cite" in h:
        by_note[h["note"]] = {"tag": "headers", "cite": h["cite"], "note": h["note"], "url": url(h)}
    sup = entry.get("supplement")
    if sup and "cite" in sup:
        by_note[sup["note"]] = {"tag": "records", "cite": sup["cite"], "note": sup["note"], "url": sup["lib"]}
    used = {p["note"] for p in doc.get("provenanceTypes", {}).values()}
    srcs += [x for n, x in by_note.items() if x is not main and n in used]
    for x, c in checks.items():
        if c:
            next(y for y in srcs if y["tag"] == x)["check"] = c
    if doc.get("attested"):
        files = [source_label(x).split("/")[-1] for x in entry["asserts"]]
        srcs.append({"tag": "names", "cite": "named by %s's ASSERT text" % " and ".join(files),
                     "note": "%d names a checked build's ASSERT text gives, without layouts" % len(doc["attested"]),
                     "url": entry["asserts"][0]["lib"]})
    doc["sources"] = srcs
    for p in [doc["provenance"], *doc.get("provenanceTypes", {}).values()]:
        x = by_note.get(p["note"], main)
        p["tag"], p["cite"] = x["tag"], x["cite"]
        one = re.search(r"; this type: (\S+)$", p["note"])  # cv3: one debugger of several
        if one:
            p["cite"] = "from %s's types, re-laid out for 32-bit" % one.group(1)


def source_label(entry):
    """A short name for a "lib" source: its last member, else the URL path's last two
    parts ("MIPS/CDPLAYER.EXE")."""
    m = entry.get("member") or []
    if m and isinstance(m[-1], str):
        return m[-1]
    if m:
        return next(iter(m[-1].values()))
    return "/".join(urllib.parse.unquote(entry["lib"]).split("/")[-2:])


def assert_names(sources, pdbdir):
    """strnames.names over an "asserts" list's (fetched) files."""
    return strnames.names([fetch_pkg(dict(x, member=x.get("member", [])), pdbdir, "lib")
                           for x in sources], [source_label(x) for x in sources])


def known_types(skip):
    """{name: kind} of every type some other committed doc (any build, arch, module, not
    the file `skip`) defines or declares: what an attested typedef name is, where a
    recorded build says."""
    out = {}
    for path in sorted(glob.glob(os.path.join(DATA, "*-*.json"))):
        if os.path.abspath(path) == os.path.abspath(skip):
            continue
        with open(path) as f:
            d = json.load(f)
        for n, k in d.get("opaque", {}).items():
            if n not in d.get("attested", {}):  # only what type records say, never ASSERT text
                out.setdefault(n, k)
        for n, i in d["named"].items():
            out[n] = d["types"][i]["kind"]
    return out


def attest(doc, names):
    """Add the names a debug build's ASSERT text attests (strnames.names) to doc.opaque,
    each under its page name: _X where a recorded build has the struct tag _X (NT's
    typedef struct _X {...} X convention), else X as written. Kind: the recorded build's,
    else "type" (unknown). Names doc already lays out are skipped."""
    known, att = known_types(json_name(doc["module"], doc["build"], doc["arch"])), {}
    for x, ev in names.items():
        page = "_" + x if "_" + x in known else x
        if page in doc["named"] or page in doc["opaque"]:
            continue
        doc["opaque"][page] = known.get(page, "type")
        att[page] = dict(ev, **{"as": x})
    doc["opaque"] = dict(sorted(doc["opaque"].items()))
    doc["attested"] = att
    print("  asserts: %d names (%d with a later layout)"
          % (len(att), sum(1 for n in att if n in known)), file=sys.stderr)


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

    if "headers" in entry and "lib" not in entry:
        spec = entry["headers"]
        doc = headers.convert(fetch_headers(spec, pdbdir), arch, entry["module"], entry["build"],
                              family, entry["note"], top=spec.get("top", "ntddk.h"),
                              only=spec.get("only"))
        if entry.get("asserts"):
            attest(doc, assert_names(entry["asserts"], pdbdir))
        cite_sources(doc, entry, {})
        for k in ("buildLabel", "incomplete"):
            if entry.get(k):
                doc[k] = entry[k]
        out = json_name(entry["module"], entry["build"], arch)
        pdb_to_json.write(doc, out)
        produced.append(out)
        return produced

    if "lib" in entry:
        checks = {}
        build, src = entry["build"], fetch_pkg(entry, pdbdir, "lib")
        more = [fetch_pkg(dict(x, member=x.get("member", [])), pdbdir, "lib")
                for x in entry.get("also", [])]
        if entry.get("format") == "cv3":
            doc = cv3.convert([src] + more, entry["module"], arch, build, family, entry["note"],
                              labels=[source_label(x) for x in [entry] + entry.get("also", [])])
        elif entry.get("format") == "kdext":
            doc = kdext.convert(src, entry["module"], arch, build, family, entry["note"])
        else:
            doc = cv4.convert([src] + more, entry["machine"], entry["module"], arch, build, family,
                              entry["note"], set(entry["names"]) if entry.get("names") else
                              re.compile(entry["namesRe"]).fullmatch if entry.get("namesRe") else None,
                              variants=entry.get("variants", False),
                              labels=[source_label(x) for x in [entry] + entry.get("also", [])])
        sup = entry.get("supplement")
        if sup:  # more types from one object of another library, if one matches this arch
            tables = cv4.type_tables(fetch_pkg(sup, pdbdir, "lib"), cv4.MACHINES[sup["machine"]])
            hit = [(o, t) for o, t in cv4.matching_tables(doc, tables, sup["match"])
                   if all(any(n.get("name") == r and n.get("fieldlist") for n in t.values())
                          for r in sup["take"])]  # ...and defines what it is taken for
            if len(hit) == 1:
                before = set(doc["named"])
                doc = cv4.convert([src], entry["machine"], entry["module"], arch, build, family,
                                  entry["note"], extra=hit)
                # document only what "take" names, and the new named types they reach
                reach = pdb_to_json.reachable(doc["types"], [doc["named"][n] for n in sup["take"]
                                                             if n in doc["named"]])
                doc["named"] = {n: k for n, k in doc["named"].items()
                                if n in before or (k in reach and n not in before)}
                doc["types"] = pdb_to_json.reachable(doc["types"], doc["named"].values())
                doc["opaque"] = {n: k for n, k in doc["opaque"].items() if n not in doc["named"]}
                doc["provenanceTypes"] = {n: {"kind": "source", "note": sup["note"]}
                                          for n in sorted(set(doc["named"]) - before)}
                print("  supplement %s: %s" % (hit[0][0], ", ".join(doc["provenanceTypes"])),
                      file=sys.stderr)
            else:
                print("  ~~ supplement: %d objects match %s here, none taken"
                      % (len(hit), "/".join(sup["match"])), file=sys.stderr)
        if entry.get("kdext"):
            ext = fetch_pkg(dict(entry["kdext"], member=[]), pdbdir, "url")
            ok, n, _, bad = kdext.check(doc, ext)
            if bad or not n:
                raise RuntimeError("%s disagrees with %s on %s" % (
                    entry["lib"], entry["kdext"]["url"], ", ".join(b[0] for b in bad) or "everything"))
            print("  kdext: %d/%d _EPROCESS/_ETHREAD offsets agree" % (ok, n), file=sys.stderr)
            checks["records"] = "all %d _EPROCESS/_ETHREAD offsets agree with %s" % (
                n, source_label(dict(entry["kdext"], lib=entry["kdext"]["url"])))
        if entry.get("headers"):
            checks["headers"] = merge_headers(doc, entry["headers"], pdbdir,
                                              set(entry["names"]) if entry.get("names") else None)
        if entry.get("asserts"):
            attest(doc, assert_names(entry["asserts"], pdbdir))
        cite_sources(doc, entry, checks)
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
