#!/usr/bin/env python3
"""Parse a PDB's TPI (type) stream into a normalized JSON type graph.

Pipeline front end for vergiliplus. Runs `llvm-pdbutil dump -types <pdb>` and
turns the CodeView type records into a flat, self-contained JSON document keyed
by type index, with the module/arch/build dimension carried at the top level so
a single module+build is one document (unlike Vergilius, where one PDB == one
"OS" and there is no module axis).

Usage:
  pdb_to_json.py <pdb> --module ntdll --arch x64 --build 10.0.26100.7824 \
      [--family F] [--file-version V] [--pdbutil /path/to/llvm-pdbutil] [-o out.json]
Also importable: convert(...) -> doc, write(doc, path).

Only the record kinds needed to render C declarations are modeled; anything else
is kept as a best-effort {kind:"other"} node so rendering degrades instead of
crashing.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from typing import Callable

HEADER = re.compile(r"^\s*0x([0-9A-Fa-f]+) \| (LF_\w+)(.*)$")
NAME = re.compile(r"`([^`]*)`")
MEMBER = re.compile(
    r"LF_MEMBER \[name = `([^`]*)`, Type = 0x([0-9A-Fa-f]+)(?: \(([^)]*)\))?,"
    r" offset = (\d+)"
)
ENUMERATE = re.compile(r"LF_ENUMERATE \[(\S+) = (-?\d+)\]")
# base/primitive types appear inline as "Type = 0x0603 (void*)" etc.
INLINE_BASE = re.compile(r"0x([0-9A-Fa-f]+) \(([^)]*)\)")


def find_pdbutil(pdbutil):
    """Locate llvm-pdbutil: explicit arg, then $LLVM_PDBUTIL, then PATH."""
    for cand in (pdbutil, os.environ.get("LLVM_PDBUTIL")):
        if cand and shutil.which(cand):
            return cand
    found = shutil.which("llvm-pdbutil")
    if found:
        return found
    sys.exit("llvm-pdbutil not found on PATH. Install LLVM (e.g. `brew install llvm`,\n"
             "`apt install llvm`, or https://releases.llvm.org) or set $LLVM_PDBUTIL.")


def run_pdbutil(pdb, pdbutil):
    exe = find_pdbutil(pdbutil)
    out = subprocess.run([exe, "dump", "-types", pdb],
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit("llvm-pdbutil failed:\n" + out.stderr)
    return out.stdout.splitlines()


def pdb_identity(pdb, pdbutil):
    """{guid, age} of the PDB itself, so a doc can be re-fetched from msdl later."""
    out = subprocess.run([find_pdbutil(pdbutil), "dump", "-summary", pdb],
                         capture_output=True, text=True).stdout
    guid = grab(r"GUID: \{([0-9A-Fa-f-]+)\}", out)
    age = grab(r"Age: (\d+)", out, cast=int)
    return {"guid": guid.replace("-", "").upper(), "age": age} if guid else None


def split_records(lines):
    """Yield (index, kind, blob_lines) for each top-level type record."""
    cur_idx = cur_kind = None
    blob = []
    for ln in lines:
        m = HEADER.match(ln)
        if m:
            if cur_idx is not None:
                yield cur_idx, cur_kind, blob
            cur_idx = int(m.group(1), 16)
            cur_kind = m.group(2)
            blob = [m.group(3)]
        elif cur_idx is not None:
            blob.append(ln)
    if cur_idx is not None:
        yield cur_idx, cur_kind, blob


def hexi(n):
    return "0x%X" % n


def grab(pat, text, grp=1, cast: Callable = str, default=None):
    m = re.search(pat, text)
    if not m or m.group(grp) is None:
        return default
    return cast(m.group(grp))


def parse(lines):
    types = {}
    bases = {}  # index -> name, collected from inline "(...)" annotations

    for idx, kind, blob in split_records(lines):
        text = "\n".join(blob)
        key = hexi(idx)

        # harvest any inline base-type refs anywhere in the record
        for bm in INLINE_BASE.finditer(text):
            bi = int(bm.group(1), 16)
            if bi < 0x1000 or bm.group(2):
                bases[hexi(bi)] = bm.group(2)

        if kind in ("LF_STRUCTURE", "LF_CLASS", "LF_UNION"):
            nm = NAME.search(text)
            fl = grab(r"field list: (?:0x([0-9A-Fa-f]+)|<no type>)", text)
            fwd = grab(r"forward ref \(-> 0x([0-9A-Fa-f]+)\)", text)
            size = grab(r"sizeof (\d+)", text, cast=int, default=0)
            types[key] = {
                "kind": "union" if kind == "LF_UNION" else "struct",
                "name": nm.group(1) if nm else None,
                "size": size,
                "fieldlist": hexi(int(fl, 16)) if fl else None,
                "forward": hexi(int(fwd, 16)) if fwd else None,
            }
        elif kind == "LF_ENUM":
            nm = NAME.search(text)
            fl = grab(r"field list: (?:0x([0-9A-Fa-f]+)|<no type>)", text)
            fwd = grab(r"forward ref \(-> 0x([0-9A-Fa-f]+)\)", text)
            types[key] = {
                "kind": "enum",
                "name": nm.group(1) if nm else None,
                "fieldlist": hexi(int(fl, 16)) if fl else None,
                "forward": hexi(int(fwd, 16)) if fwd else None,
            }
        elif kind == "LF_FIELDLIST":
            members = []
            for mm in MEMBER.finditer(text):
                name, ti, paren, off = mm.groups()
                if paren:
                    bases[hexi(int(ti, 16))] = paren
                members.append({
                    "name": name, "type": hexi(int(ti, 16)), "offset": int(off),
                })
            enums = [{"name": n, "value": int(v)}
                     for n, v in ENUMERATE.findall(text)]
            types[key] = {"kind": "fieldlist", "members": members, "enums": enums}
        elif kind == "LF_POINTER":
            ref = grab(r"referent = 0x([0-9A-Fa-f]+)", text)
            types[key] = {"kind": "pointer",
                          "referent": hexi(int(ref, 16)) if ref else None}
        elif kind == "LF_ARRAY":
            el = grab(r"element type: 0x([0-9A-Fa-f]+)", text)
            sz = grab(r"size: (\d+)", text, cast=int, default=0)
            types[key] = {"kind": "array",
                          "element": hexi(int(el, 16)) if el else None,
                          "bytes": sz}
        elif kind == "LF_MODIFIER":
            ref = grab(r"referent = 0x([0-9A-Fa-f]+)", text)
            mods = grab(r"modifiers = (.+)$", text) or ""
            types[key] = {"kind": "modifier",
                          "referent": hexi(int(ref, 16)) if ref else None,
                          "const": "const" in mods, "volatile": "volatile" in mods}
        elif kind == "LF_BITFIELD":
            ty = grab(r"type = 0x([0-9A-Fa-f]+)", text)
            bits = grab(r"# bits = (\d+)", text, cast=int, default=0)
            pos = grab(r"bit offset = (\d+)", text, cast=int, default=0)
            types[key] = {"kind": "bitfield",
                          "type": hexi(int(ty, 16)) if ty else None,
                          "bits": bits, "pos": pos}
        elif kind == "LF_PROCEDURE":
            ret = grab(r"return type = 0x([0-9A-Fa-f]+)", text)
            args = grab(r"param list = 0x([0-9A-Fa-f]+)", text)
            types[key] = {"kind": "proc",
                          "return": hexi(int(ret, 16)) if ret else None,
                          "args": hexi(int(args, 16)) if args else None}
        elif kind == "LF_ARGLIST":
            # one "0xIDX[ (name)]: `type`" line per parameter
            types[key] = {"kind": "arglist",
                          "args": [hexi(int(a, 16)) for a in
                                   re.findall(r"^\s*0x([0-9A-Fa-f]+)(?: \([^)]*\))?: `",
                                              text, re.M)]}
        else:
            types[key] = {"kind": "other", "lf": kind}

    for bk, bn in bases.items():
        types.setdefault(bk, {"kind": "base", "name": bn})

    return types


def reachable(types, roots):
    """Type records reachable from the documented types. The rest of the TPI stream
    (other modules' arglists, procs, pointers nothing we render points at) is
    dropped: about a quarter of the records."""
    seen, stack = set(), list(roots)
    while stack:
        k = stack.pop()
        if not isinstance(k, str) or k in seen or k not in types:
            continue
        seen.add(k)
        t = types[k]
        for f in ("fieldlist", "forward", "referent", "element", "type", "return"):
            stack.append(t.get(f))
        args = t.get("args")
        stack.extend(args if isinstance(args, list) else [args])
        stack.extend(m["type"] for m in t.get("members", []))
    return {k: types[k] for k in types if k in seen}


def convert(pdb, module, arch, build, family="", file_version=None, pdbutil=None):
    """PDB -> the vergiliplus doc for one module x build x arch."""
    types = parse(run_pdbutil(pdb, pdbutil))
    # index of renderable top-level named types (definitions, not forward refs)
    named = {}
    for key, t in types.items():
        if t.get("kind") in ("struct", "union", "enum") and t.get("name") \
                and t.get("fieldlist") and not t.get("forward"):
            named[t["name"]] = key
    return {
        "module": module, "arch": arch, "build": build, "family": family,
        "fileVersion": file_version, "pdb": pdb_identity(pdb, pdbutil),
        "named": named, "types": reachable(types, named.values()),
    }


def write(doc, path):
    """Compact JSON, one doc per file (data/ is the committed artifact)."""
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print("wrote %s  (%d types, %d named)" % (path, len(doc["types"]), len(doc["named"])),
          file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdb")
    ap.add_argument("--module", required=True)
    ap.add_argument("--arch", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--family", default="")
    ap.add_argument("--file-version", default=None,
                    help="the module's PE FileVersion, when known")
    ap.add_argument("--pdbutil", default=None)
    ap.add_argument("-o", "--out", default=None)
    args = ap.parse_args()
    doc = convert(args.pdb, args.module, args.arch, args.build, args.family,
                  args.file_version, args.pdbutil)
    if args.out:
        write(doc, args.out)
    else:
        json.dump(doc, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
