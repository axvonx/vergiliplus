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

PDB 2.0 files (Windows 2000 symbols), which llvm-pdbutil cannot open, are read by
parse20() below instead, producing the same nodes.

Only the record kinds needed to render C declarations are modeled; anything else
is kept as a best-effort {kind:"other"} node so rendering degrades instead of
crashing.
"""
import argparse
import contextlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
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


def run_tool(argv, stdin=None, check=True):
    out = subprocess.run(argv, input=stdin, capture_output=True, text=True)
    if (out.returncode != 0 if check else not out.stdout):
        sys.exit(os.path.basename(argv[0]) + " failed:\n" + out.stderr)
    return out.stdout


TPI_V70, TPI_V80 = 19990903, 20040203


def tpi_header_offset(f):
    """File offset of the TPI stream (MSF stream 2) header in an open PDB."""
    f.seek(0)
    sb = f.read(56)
    if not sb.startswith(b"Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0"):
        return None
    bs, _, _, dirsize, _, dirmap = struct.unpack_from("<6I", sb, 32)
    f.seek(dirmap * bs)
    blocks = struct.unpack("<%dI" % (-(-dirsize // bs)), f.read(4 * -(-dirsize // bs)))
    d = b""
    for b in blocks:  # the directory up to stream 2's block list
        f.seek(b * bs)
        d += f.read(bs)
    n = struct.unpack_from("<I", d)[0]
    sizes = struct.unpack_from("<%dI" % n, d, 4)
    off = 4 + 4 * n + sum(4 * -(-z // bs) for z in sizes[:2] if z != 0xFFFFFFFF)
    return struct.unpack_from("<I", d, off)[0] * bs


@contextlib.contextmanager
def readable(pdb):
    """A path llvm-pdbutil can read. VC 7.x PDBs (Server 2003 era) have a V70 TPI
    header that LLVM refuses (and -publics crashes on); the records themselves are
    the V80 ones. Such a PDB is read from a temporary copy whose header says V80 with
    4-byte hash keys and no hash stream (only name lookup uses it)."""
    with open(pdb, "rb") as f:
        hdr = tpi_header_offset(f)
        f.seek(hdr or 0)
        ver = struct.unpack("<I", f.read(4))[0] if hdr is not None else None
    if ver != TPI_V70:
        yield pdb
        return
    with tempfile.TemporaryDirectory() as tmp:
        copy = os.path.join(tmp, os.path.basename(pdb))
        shutil.copyfile(pdb, copy)
        with open(copy, "r+b") as f:
            f.seek(hdr)
            f.write(struct.pack("<I", TPI_V80))
            f.seek(hdr + 20)  # HashStreamIndex, HashAuxStreamIndex, HashKeySize
            f.write(struct.pack("<HHI", 0xFFFF, 0xFFFF, 4))
        yield copy


def run_pdbutil(pdb, pdbutil):
    with readable(pdb) as p:
        return run_tool([find_pdbutil(pdbutil), "dump", "-types", p]).splitlines()


def find_undname(pdbutil):
    """llvm-undname ships with llvm-pdbutil: look beside it first, then PATH."""
    exe = find_pdbutil(pdbutil)
    beside = os.path.join(os.path.dirname(shutil.which(exe) or exe), "llvm-undname")
    found = shutil.which(beside) or shutil.which("llvm-undname")
    if not found:
        sys.exit("llvm-undname not found (it ships with LLVM, next to llvm-pdbutil).")
    return found


# A type named in a demangled signature: its tag keyword, then a qualified name
# whose template arguments may nest (`struct ST_STORE<struct SM_TRAITS>::_ST_DATA_MGR`)
DEMANGLED_TAG = re.compile(r"\b(struct|union|enum|class) (?=[A-Za-z_])")
TAG_KIND = {"union": "union", "struct": "struct", "class": "struct", "enum": "enum"}
IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def qualified_name(s, i):
    """The qualified name starting at s[i], as the PDB spells it (no tag keywords
    inside template arguments), or None if it involves an unnamed scope."""
    out = []
    while True:
        m = IDENT.match(s, i)
        if not m:
            return None
        out.append(m.group())
        i = m.end()
        if s.startswith("<", i):
            depth, j = 0, i
            while j < len(s):
                depth += {"<": 1, ">": -1}.get(s[j], 0)
                j += 1
                if depth == 0:
                    break
            if depth:
                return None
            out.append(DEMANGLED_TAG.sub("", s[i:j]))
            i = j
        if not s.startswith("::", i):
            return "".join(out)
        out.append("::")
        i += 2


def mangled_type_names(pdb, pdbutil):
    """Aggregate names that appear only inside mangled C++ public symbols. Newer
    internals (e.g. the canary AutoBoost _AB_* family) have no type records in the
    public PDB at all, so their signatures are the only place the names exist."""
    with readable(pdb) as p:
        out = run_tool([find_pdbutil(pdbutil), "dump", "-publics", p])
    syms = re.findall(r"`(\?[^`]+)`", out)
    if not syms:
        return {}
    # exits 1 if any one symbol fails to demangle, but still demangles the rest
    demangled = run_tool([find_undname(pdbutil)], stdin="\n".join(syms) + "\n", check=False)
    names = {}
    for line in demangled.splitlines():
        for m in DEMANGLED_TAG.finditer(line):
            name = qualified_name(line, m.end())
            last = name and re.sub(r"<.*>", "", name).rsplit("::", 1)[-1]
            if last and (last.startswith("_") or last[:1].isupper()):
                names.setdefault(name, TAG_KIND[m.group(1)])
    return names


def pdb_identity(pdb, pdbutil):
    """{guid, age} of the PDB itself, so a doc can be re-fetched from msdl later."""
    if is_pdb20(pdb):
        return pdb20_identity(pdb)
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

    resolve_forwards(types)
    return types


def resolve_forwards(types):
    """llvm-pdbutil prints a forward ref's target ("-> 0x..") only via the TPI hash
    stream, which readable() drops for VC 7.x PDBs (and PDB 2.0 has none): resolve those
    by name instead."""
    defs = {(t["kind"], t["name"]): k for k, t in types.items()
            if t.get("fieldlist") and t.get("name")}
    for t in types.values():
        if t.get("kind") in ("struct", "union", "enum") and not t.get("fieldlist") \
                and not t.get("forward"):
            t["forward"] = defs.get((t["kind"], t.get("name")))


# ---------------------------------------------------------------------------
# PDB 2.0 ("Microsoft C/C++ program database 2.00", VC 4-6; Windows 2000 symbols).
# llvm-pdbutil cannot open these (16-bit page numbers, a different directory), so the
# TPI stream is read here directly. The output is the same node shape parse() makes.

PDB20_MAGIC = b"Microsoft C/C++ program database 2.00\r\n\x1aJG\0\0"


def is_pdb20(path):
    with open(path, "rb") as f:
        return f.read(len(PDB20_MAGIC)) == PDB20_MAGIC


def pdb20_streams(path):
    """The MSF 2.0 streams of a PDB as a list of bytes (None for a deleted stream)."""
    with open(path, "rb") as f:
        b = f.read()
    page, _, _, root_size = struct.unpack_from("<IHHI", b, 44)
    npg = -(-root_size // page)
    root_pages = struct.unpack_from("<%dH" % npg, b, 56 + 4)

    def read(pages, size):
        return b"".join(b[p * page:(p + 1) * page] for p in pages)[:size]

    root = read(root_pages, root_size)
    n = struct.unpack_from("<H", root, 0)[0]
    sizes = [struct.unpack_from("<I", root, 4 + 8 * i)[0] for i in range(n)]
    pos, out = 4 + 8 * n, []
    for z in sizes:
        k = -(-z // page) if z != 0xFFFFFFFF else 0
        pages = struct.unpack_from("<%dH" % k, root, pos)
        pos += 2 * k
        out.append(read(pages, z) if z != 0xFFFFFFFF else None)
    return out


def pdb20_identity(path):
    """{signature, age} of a PDB 2.0 (it has a timestamp signature, not a GUID)."""
    pdbs = pdb20_streams(path)[1]
    _, sig, age = struct.unpack_from("<III", pdbs, 0)
    return {"guid": None, "signature": sig, "age": age}


# CodeView simple types -> the names llvm-pdbutil prints for them
CV_SIMPLE = {
    0x03: "void", 0x07: "<not translated>", 0x08: "HRESULT",
    0x10: "signed char", 0x20: "unsigned char", 0x68: "__int8", 0x69: "unsigned __int8",
    0x70: "char", 0x71: "wchar_t", 0x72: "__int16", 0x73: "unsigned __int16",
    0x74: "int", 0x75: "unsigned", 0x76: "__int64", 0x77: "unsigned __int64",
    0x78: "__int128", 0x79: "unsigned __int128",
    0x11: "short", 0x21: "unsigned short", 0x12: "long", 0x22: "unsigned long",
    0x13: "__int64", 0x23: "unsigned __int64",
    0x40: "float", 0x41: "double", 0x42: "long double", 0x30: "bool",
    0x31: "__bool16", 0x32: "__bool32", 0x33: "__bool64",
}
CV_PTR_MODES = (0x100, 0x200, 0x300, 0x400, 0x500, 0x600)  # near16 .. near64


def cv_simple_name(ti):
    """Name of a primitive type index (< 0x1000), pointer variants included; None if
    unknown."""
    mode = ti & 0x700
    base = CV_SIMPLE.get(ti & 0xFF)
    if base is None or (mode and mode not in CV_PTR_MODES):
        return None
    return base + "*" if mode else base


def cv_numeric(d, o):
    """A CodeView numeric leaf (inline < 0x8000, else a typed little-endian value)."""
    v = struct.unpack_from("<H", d, o)[0]
    if v < 0x8000:
        return v, o + 2
    size, signed = {0x8000: (1, True), 0x8001: (2, True), 0x8002: (2, False),
                    0x8003: (4, True), 0x8004: (4, False),
                    0x8009: (8, True), 0x800a: (8, False)}.get(v, (None, False))
    if size is None:
        raise ValueError("unsupported numeric leaf 0x%x" % v)
    return int.from_bytes(d[o + 2:o + 2 + size], "little", signed=signed), o + 2 + size


def cv_pstr(d, o):
    n = d[o]
    return d[o + 1:o + 1 + n].decode("latin1"), o + 1 + n


def cv_fieldlist(d):
    """Members, enumerators and the continuation (LF_INDEX) of an LF_FIELDLIST body:
    32-bit _ST sub-leaves (VC 4-6) and 16-bit ones (CodeView 4 in NT 3.x/4.0 objects)."""
    members, enums, nxt, o = [], [], None, 0
    while o < len(d):
        sub = struct.unpack_from("<H", d, o)[0]
        if sub == 0x1405:      # LF_MEMBER_ST: attr, type, offset, name
            ti = struct.unpack_from("<I", d, o + 4)[0]
            off, p = cv_numeric(d, o + 8)
            name, o = cv_pstr(d, p)
            members.append({"name": name, "type": hexi(ti), "offset": off})
        elif sub == 0x0406:    # LF_MEMBER (16-bit): type, attr, offset, name
            ti = struct.unpack_from("<H", d, o + 2)[0]
            off, p = cv_numeric(d, o + 6)
            name, o = cv_pstr(d, p)
            members.append({"name": name, "type": hexi(ti), "offset": off})
        elif sub == 0x0403:    # LF_ENUMERATE: attr, value, name
            val, p = cv_numeric(d, o + 4)
            name, o = cv_pstr(d, p)
            enums.append({"name": name, "value": val})
        elif sub == 0x1400:    # LF_BCLASS: attr, type, offset
            _, o = cv_numeric(d, o + 8)
        elif sub == 0x0400:    # LF_BCLASS (16-bit): type, attr, offset
            _, o = cv_numeric(d, o + 6)
        elif sub in (0x1401, 0x1402):  # LF_VBCLASS/IVBCLASS: attr, type, vbptr, 2 numerics
            _, p = cv_numeric(d, o + 12)
            _, o = cv_numeric(d, p)
        elif sub == 0x1404:    # LF_INDEX: pad, continuation type
            nxt = hexi(struct.unpack_from("<I", d, o + 4)[0])
            o += 8
        elif sub == 0x0405:    # LF_INDEX (16-bit): continuation type
            nxt = hexi(struct.unpack_from("<H", d, o + 2)[0])
            o += 4
        elif sub == 0x1406:    # LF_STMEMBER_ST: attr, type, name
            _, o = cv_pstr(d, o + 8)
        elif sub == 0x1407:    # LF_METHOD_ST: count, method list, name
            _, o = cv_pstr(d, o + 8)
        elif sub == 0x1408:    # LF_NESTTYPE_ST: pad, type, name
            _, o = cv_pstr(d, o + 8)
        elif sub in (0x0409, 0x0404):  # LF_NESTTYPE / LF_FRIENDFCN (16-bit): type, name
            _, o = cv_pstr(d, o + 4)
        elif sub in (0x0407, 0x0408):  # LF_STMEMBER / LF_METHOD (16-bit): 2 words, name
            _, o = cv_pstr(d, o + 6)
        elif sub in (0x040A, 0x040B):  # LF_VFUNCTAB / LF_FRIENDCLS (16-bit): type
            o += 4
        elif sub in (0x0401, 0x0402):  # LF_VBCLASS/IVBCLASS (16-bit): 3 words, 2 numerics
            _, p = cv_numeric(d, o + 8)
            _, o = cv_numeric(d, p)
        elif sub == 0x040C:    # LF_ONEMETHOD (16-bit): attr, type, [vbase offset], name
            attr = struct.unpack_from("<H", d, o + 2)[0]
            _, o = cv_pstr(d, o + 6 + (4 if ((attr >> 2) & 7) in (4, 6) else 0))
        elif sub in (0x1409, 0x140a):  # LF_VFUNCTAB / LF_FRIENDCLS: pad, type
            o += 8
        elif sub == 0x140b:    # LF_ONEMETHOD_ST: attr, type, [vbase offset], name
            attr = struct.unpack_from("<H", d, o + 2)[0]
            _, o = cv_pstr(d, o + 8 + (4 if ((attr >> 2) & 7) in (4, 6) else 0))
        else:
            raise ValueError("unknown field list sub-leaf 0x%04x" % sub)
        while o < len(d) and d[o] >= 0xF0:  # LF_PADn
            o += d[o] & 0x0F
    return members, enums, nxt


def cv_records(blob, tmin=0x1000, tmax=None):
    """A CodeView type table (records from type index tmin on) -> {hex index: node}, the
    nodes parse() makes. Reads the 32-bit _ST leaves of PDB 2.0 and the 16-bit leaves of
    CodeView 4 objects (.debug$T in NT 3.x/4.0 DDK libraries). Primitive types are
    added for the indices referenced; forward references are left unresolved."""
    types, o, ti = {}, 0, tmin
    while o + 4 <= len(blob) and (tmax is None or ti < tmax):
        ln, leaf = struct.unpack_from("<HH", blob, o)
        if ln < 2:
            break
        d = blob[o + 4:o + 2 + ln]
        o, key = o + 2 + ln, hexi(ti)
        ti += 1
        if leaf in (0x1004, 0x1005, 0x1006, 0x0004, 0x0005, 0x0006):
            # LF_CLASS/STRUCTURE/UNION, _ST (32-bit indices) or 16-bit
            if leaf >= 0x1000:     # count, property, field (u32)[, derived, vshape]
                _, prop, fl = struct.unpack_from("<HHI", d, 0)
                p = 8 if leaf == 0x1006 else 16
            else:                  # count, field (u16), property[, derived, vshape]
                _, fl, prop = struct.unpack_from("<HHH", d, 0)
                p = 6 if leaf == 0x0006 else 10
            size, p = cv_numeric(d, p)
            name, _ = cv_pstr(d, p)
            fwd = bool(prop & 0x80)
            types[key] = {"kind": "union" if leaf & 0xFFF == 6 else "struct", "name": name,
                          "size": 0 if fwd else size,
                          "fieldlist": hexi(fl) if fl and not fwd else None, "forward": None}
        elif leaf in (0x1007, 0x0007):
            if leaf == 0x1007:     # LF_ENUM_ST: count, property, type, field, name
                _, prop, _, fl = struct.unpack_from("<HHII", d, 0)
                name, _ = cv_pstr(d, 12)
            else:                  # LF_ENUM (16-bit): count, type, field, property, name
                _, _, fl, prop = struct.unpack_from("<HHHH", d, 0)
                name, _ = cv_pstr(d, 8)
            types[key] = {"kind": "enum", "name": name,
                          "fieldlist": hexi(fl) if fl and not prop & 0x80 else None,
                          "forward": None}
        elif leaf in (0x1203, 0x0204):         # LF_FIELDLIST
            members, enums, nxt = cv_fieldlist(d)
            types[key] = {"kind": "fieldlist", "members": members, "enums": enums}
            if nxt:
                types[key]["next"] = nxt
        elif leaf == 0x1002:                   # LF_POINTER: referent, attributes
            types[key] = {"kind": "pointer", "referent": hexi(struct.unpack_from("<I", d, 0)[0])}
        elif leaf == 0x0002:                   # LF_POINTER (16-bit): attributes, referent
            types[key] = {"kind": "pointer", "referent": hexi(struct.unpack_from("<H", d, 2)[0])}
        elif leaf in (0x1003, 0x0003):         # LF_ARRAY: element, index, size, name
            if leaf == 0x1003:
                el, p = struct.unpack_from("<I", d, 0)[0], 8
            else:
                el, p = struct.unpack_from("<H", d, 0)[0], 4
            size, _ = cv_numeric(d, p)
            types[key] = {"kind": "array", "element": hexi(el), "bytes": size}
        elif leaf in (0x1001, 0x0001):         # LF_MODIFIER
            if leaf == 0x1001:     # type, attributes
                ref, attr = struct.unpack_from("<IH", d, 0)
            else:                  # attributes, type
                attr, ref = struct.unpack_from("<HH", d, 0)
            types[key] = {"kind": "modifier", "referent": hexi(ref),
                          "const": bool(attr & 1), "volatile": bool(attr & 2)}
        elif leaf == 0x1205:                   # LF_BITFIELD: type, length, position
            ty, bits, pos = struct.unpack_from("<IBB", d, 0)
            types[key] = {"kind": "bitfield", "type": hexi(ty), "bits": bits, "pos": pos}
        elif leaf == 0x0206:                   # LF_BITFIELD (16-bit): length, position, type
            bits, pos, ty = struct.unpack_from("<BBH", d, 0)
            types[key] = {"kind": "bitfield", "type": hexi(ty), "bits": bits, "pos": pos}
        elif leaf == 0x1008:                   # LF_PROCEDURE: return, conv, res, count, args
            ret, _, _, _, args = struct.unpack_from("<IBBHI", d, 0)
            types[key] = {"kind": "proc", "return": hexi(ret), "args": hexi(args)}
        elif leaf == 0x0008:                   # LF_PROCEDURE (16-bit), u16 indices
            ret, _, _, _, args = struct.unpack_from("<HBBHH", d, 0)
            types[key] = {"kind": "proc", "return": hexi(ret), "args": hexi(args)}
        elif leaf == 0x1201:                   # LF_ARGLIST: count, types
            n = struct.unpack_from("<I", d, 0)[0]
            types[key] = {"kind": "arglist",
                          "args": [hexi(a) for a in struct.unpack_from("<%dI" % n, d, 4)]}
        elif leaf == 0x0201:                   # LF_ARGLIST (16-bit)
            n = struct.unpack_from("<H", d, 0)[0]
            types[key] = {"kind": "arglist",
                          "args": [hexi(a) for a in struct.unpack_from("<%dH" % n, d, 2)]}
        else:
            types[key] = {"kind": "other", "lf": "LF_0x%04X" % leaf}

    # a long field list continues in another record (LF_INDEX): splice the chain
    for t in types.values():
        seen = set()
        while t.get("next") in types and t["next"] not in seen:
            seen.add(t["next"])
            more = types[t.pop("next")]
            t["members"] += more.get("members", [])
            t["enums"] += more.get("enums", [])
            if more.get("next"):
                t["next"] = more["next"]
        t.pop("next", None)

    # primitive types are implicit: add the ones the records refer to
    seen = set()
    for t in types.values():
        for f in ("referent", "element", "type", "return"):
            seen.add(t.get(f))
        seen.update(t.get("args") if isinstance(t.get("args"), list) else [])
        seen.update(m["type"] for m in t.get("members", []))
    for s in sorted(x for x in seen if x):  # sorted: stable output across runs
        if int(s, 16) < 0x1000 and s not in types:
            name = cv_simple_name(int(s, 16))
            if name:
                types[s] = {"kind": "base", "name": name}
    return types


def parse20(path):
    """TPI of a PDB 2.0 -> {hex index: node}, as parse() does for llvm-pdbutil text."""
    tpi = pdb20_streams(path)[2]
    ver, hdr, tmin, tmax, cb = struct.unpack_from("<IIIII", tpi, 0)
    if ver != 19961031:
        raise ValueError("unexpected TPI version %d in %s" % (ver, path))
    types = cv_records(tpi[hdr:hdr + cb], tmin, tmax)
    resolve_forwards(types)
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
    pdb20 = is_pdb20(pdb)
    types = parse20(pdb) if pdb20 else parse(run_pdbutil(pdb, pdbutil))
    # index of renderable top-level named types (definitions, not forward refs)
    named, declared = {}, {}
    for key, t in types.items():
        if t.get("kind") not in ("struct", "union", "enum") or not t.get("name") \
                or t["name"].startswith("<"):
            continue
        if t.get("fieldlist") and not t.get("forward"):
            named[t["name"]] = key
        else:
            declared.setdefault(t["name"], t["kind"])
    # opaque: names this PDB knows but never defines, as {name: kind}, from forward
    # declarations and from mangled public symbols (whose tag gives the kind)
    opaque = {n: k for n, k in declared.items() if n not in named}
    # (a PDB 2.0 has no public symbol table we read: forward declarations only)
    for n, k in ({} if pdb20 else mangled_type_names(pdb, pdbutil)).items():
        if n not in named:
            opaque.setdefault(n, k)
    return {
        "module": module, "arch": arch, "build": build, "family": family,
        "fileVersion": file_version, "pdb": pdb_identity(pdb, pdbutil),
        "named": named, "opaque": dict(sorted(opaque.items())),
        "types": reachable(types, named.values()),
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
