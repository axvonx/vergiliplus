#!/usr/bin/env python3
"""CodeView 3 (NB00-NB02, 1989-91) types of a 16-bit-hosted executable -> a vergiliplus
doc with *computed* 32-bit layouts.

The 1991 NT kernel debuggers (I386KD.EXE, MIPSKD.EXE: OS/2 NE executables) carry the
kernel structures they decode, but compiled 1-byte packed for their 16-bit host. Their
natural layout in the 32-bit kernel is recomputed: char/short/long 1/2/4, every pointer
4, float 4, double 8, each member at its natural alignment, a struct aligned to its
widest member and padded to it. A bitfield run keeps its host storage unit (the bytes up
to the next member, rounded to 1/2/4). A struct whose members all sit at host offset 0 is
a union. Members whose computed offset differs from the host's keep it as "hostOffset".

CV3 records: 0x01 linkage, u16 length, then tagged leaf bytes: 0x79 structure, 0x7f
list, 0x7a pointer, 0x78 array, 0x5c bitfield, 0x75 procedure, 0x7b enum, 0x80 nil (an
emitted-empty type: a pointer to it is void*), 0x82 string, 0x83 index (u16); numerics
< 0x80 inline, else 0x85/0x86 (u16/u32), 0x88/0x89/0x8a (s8/s16/s32). Type indices
start at 512 per module; below that, primitives: mode (ti>>5)&3 (nonzero: a pointer),
kind (ti>>2)&7, size ti&3. Struct lengths are in bits.

Only NT-convention names (_UPPER_CASE) are documented, minus the debugger's own
bookkeeping (HOST_ONLY), whose 32-bit relayout would describe nothing real; anything a
documented type reaches comes along.

  cv3.py EXE --arch x86 --build 0.1991.10.0 [--note N] [-o out.json]
"""
import argparse
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import pdb_to_json as P  # noqa: E402

NT_NAME = re.compile(r"^_[A-Z][A-Z0-9_]*$")
# the debuggers' host-side structures (symbol/process bookkeeping, packet queues)
HOST_ONLY = {"_ADDR", "_IMAGE_INFO", "_PROCESS_INFO", "_KD_PACKET_QUEUE",
             "_KD_PACKET_QUEUE_ENTRY", "_FUNCTION_ENTRY"}
ANON = ("(untagged)", None, "")
PRIM_SIZE = {0: 1, 1: 2, 2: 4, 3: 8}
REAL_SIZE = {0: 4, 1: 8, 2: 10}


def num(d, o):
    t = d[o]
    if t < 0x80:
        return t, o + 1
    fmt = {0x85: "<H", 0x86: "<I", 0x88: "<b", 0x89: "<h", 0x8A: "<i"}.get(t)
    if not fmt:
        raise ValueError("CV3 numeric leaf 0x%x" % t)
    return struct.unpack_from(fmt, d, o + 1)[0], o + 1 + struct.calcsize(fmt)


def idx(d, o):
    if d[o] != 0x83:
        raise ValueError("CV3 index leaf expected, got 0x%x" % d[o])
    return struct.unpack_from("<H", d, o + 1)[0], o + 3


def sstr(d, o):
    if d[o] != 0x82:
        raise ValueError("CV3 string leaf expected, got 0x%x" % d[o])
    n = d[o + 1]
    return d[o + 2:o + 2 + n].decode("latin1"), o + 2 + n


def type_tables(exe):
    """[{ti: record bytes}] per module of an executable's sstTypes (0x103) subsections.
    The NB0x signature sits lfo bytes before the end (lfo = the file's last dword)."""
    b = open(exe, "rb").read()
    base = len(b) - struct.unpack_from("<I", b, len(b) - 4)[0]
    if b[base:base + 4] not in (b"NB00", b"NB01", b"NB02"):
        raise ValueError("no CodeView 3 (NB00-NB02) debug info in %s" % exe)
    lfodir = struct.unpack_from("<I", b, base + 4)[0]
    out = []
    for i in range(struct.unpack_from("<H", b, base + lfodir)[0]):
        sst, _, off, cb = struct.unpack_from("<HHIH", b, base + lfodir + 2 + 10 * i)
        if sst != 0x103:
            continue
        t, recs, o, ti = b[base + off:base + off + cb], {}, 0, 512
        while o + 3 <= len(t) and t[o] == 0x01:
            ln = struct.unpack_from("<H", t, o + 1)[0]
            recs[ti] = t[o + 3:o + 3 + ln]
            o, ti = o + 3 + ln, ti + 1
        out.append(recs)
    return out


def struct_head(d):
    """(bits, member count, type list, name list, name) of a 0x79 record."""
    o = 1
    bits, o = num(d, o)
    n, o = num(d, o)
    tl, o = idx(d, o)
    nl, o = idx(d, o)
    name = sstr(d, o)[0] if o < len(d) and d[o] == 0x82 else None
    return bits, n, tl, nl, name


def host_members(recs, tl, nl):
    """[(host offset, name, type index)] of a struct's parallel type / name lists."""
    ts, ns = recs.get(tl, b""), recs.get(nl, b"")
    types, o = [], 1
    while ts[:1] == b"\x7f" and o < len(ts) and ts[o] == 0x83:
        t, o = idx(ts, o)
        types.append(t)
    names, o = [], 1
    while ns[:1] == b"\x7f" and o < len(ns) and ns[o] == 0x82:
        n, o = sstr(ns, o)
        off, o = num(ns, o)
        names.append((n, off))
    return [(off, n, types[i] if i < len(types) else 0) for i, (n, off) in enumerate(names)]


def prim_name(kind, sz):
    if kind == 0:
        return {0: "char", 1: "short", 2: "long", 3: "__int64"}[sz]
    if kind == 1:
        return {0: "unsigned char", 1: "unsigned short", 2: "unsigned long", 3: "unsigned __int64"}[sz]
    if kind == 2:
        return {0: "float", 1: "double", 2: "long double"}.get(sz, "double")
    if kind == 4:
        return {0: "unsigned char", 1: "unsigned short", 2: "unsigned long"}.get(sz, "unsigned long")
    if kind == 5:
        return "char"
    return "void"


class Graph:
    """CV3 records of all modules -> one doc graph with natural 32-bit layouts."""

    def __init__(self, tables):
        self.tables, self.types, self.ids, self.next = tables, {}, {}, 0x1000
        self.lay, self.pending = {}, []
        self.defs = {}  # struct name -> (module, ti): first definition wins
        self.disagree = set()
        for m, recs in enumerate(tables):
            for ti, d in recs.items():
                if d[:1] != b"\x79":
                    continue
                try:
                    bits, _, _, _, name = struct_head(d)
                except ValueError:
                    continue
                if name in ANON:
                    continue
                if name not in self.defs:
                    self.defs[name] = (m, ti)
                elif struct_head(tables[self.defs[name][0]][self.defs[name][1]])[0] != bits:
                    self.disagree.add(name)

    def intern(self, key, node):
        if key not in self.ids:
            self.ids[key] = P.hexi(self.next)
            self.next += 1
            self.types[self.ids[key]] = node
        return self.ids[key]

    def base(self, name):
        return self.intern(("B", name), {"kind": "base", "name": name})

    def rec(self, m, ti):
        return self.tables[m].get(ti) or b"\x80"

    # ---- sizes: host (as recorded, packed) and natural (32-bit target) ----
    def host_size(self, m, ti):
        if ti < 512:
            mode, kind, sz = (ti >> 5) & 3, (ti >> 2) & 7, ti & 3
            if mode:
                return 4
            if kind == 2:
                return REAL_SIZE.get(sz, 8)
            return 0 if kind == 7 else PRIM_SIZE[sz]
        d = self.rec(m, ti)
        if d[0] in (0x78, 0x79, 0x7B):
            return num(d, 1)[0] // 8
        return 4 if d[0] == 0x7A else 0

    def natural(self, m, ti):
        """(size, align) in the 32-bit kernel."""
        if ti < 512:
            mode, kind, sz = (ti >> 5) & 3, (ti >> 2) & 7, ti & 3
            if mode:
                return 4, 4
            if kind == 2:
                s = REAL_SIZE.get(sz, 8)
                return s, min(s, 8)
            if kind == 7:
                return 0, 1
            return PRIM_SIZE[sz], PRIM_SIZE[sz]
        d = self.rec(m, ti)
        if d[0] == 0x78:
            bits, o = num(d, 1)
            et, _ = idx(d, o)
            s, a = self.natural(m, et)
            return s * (bits // 8 // (self.host_size(m, et) or 1)), a
        if d[0] == 0x79:
            L = self.layout(m, ti)
            return L["size"], L["align"]
        return 4, 4  # pointer, enum, procedure pointer

    # ---- nodes ----
    def ref(self, m, ti):
        """Doc index of module m's type ti."""
        if ti < 512:
            mode, kind, sz = (ti >> 5) & 3, (ti >> 2) & 7, ti & 3
            name = prim_name(kind, sz)
            return self.base(name + "*" if mode else name)
        d = self.rec(m, ti)
        leaf = d[0]
        if leaf == 0x7A:  # pointer: model byte, then the referent (absent or nil: void)
            r = None
            if len(d) > 3 and d[2] == 0x83:
                t, _ = idx(d, 2)
                if t < 512 or self.rec(m, t)[0] != 0x80:
                    r = self.ref(m, t)
            r = r or self.base("void")
            return self.intern(("p", r), {"kind": "pointer", "referent": r})
        if leaf == 0x78:
            et, _ = idx(d, num(d, 1)[1])
            e, size = self.ref(m, et), self.natural(m, ti)[0]
            return self.intern(("a", e, size), {"kind": "array", "element": e, "bytes": size})
        if leaf == 0x79:
            name = struct_head(d)[4]
            if name not in ANON:
                return self.named(name)
            L = self.layout(m, ti)
            fl = self.fieldlist(L["members"])
            return self.intern(("A", L["kind"], L["size"], fl),
                               {"kind": L["kind"], "name": "<unnamed-tag>", "size": L["size"],
                                "fieldlist": fl, "forward": None})
        if leaf == 0x75:  # procedure: return type; no parameter list recorded
            r = self.base("void")
            if len(d) > 4 and d[2] == 0x83:
                r = self.ref(m, idx(d, 2)[0])
            return self.intern(("f", r), {"kind": "proc", "return": r, "args": None})
        if leaf == 0x7B:
            return self.base("long")
        return self.base("void")

    def named(self, name):
        key = ("N", name)
        if key in self.ids:
            return self.ids[key]
        m, ti = self.defs[name]
        node = {"kind": "struct", "name": name, "size": 0, "fieldlist": None, "forward": None}
        i = self.intern(key, node)  # before the members: they may point back at it
        if (m, ti) in self.lay and self.lay[(m, ti)] is None:
            self.pending.append((node, m, ti))  # reached from inside its own layout
        else:
            self.fill(node, m, ti)
        return i

    def fill(self, node, m, ti):
        L = self.layout(m, ti)
        node.update(kind=L["kind"], size=L["size"], fieldlist=self.fieldlist(L["members"]))

    def settle(self):
        """Fill the nodes whose layouts were in progress when first named."""
        while self.pending:
            self.fill(*self.pending.pop())

    def fieldlist(self, members):
        key = ("F", json.dumps(members))
        return self.intern(key, {"kind": "fieldlist", "members": members, "enums": []})

    def layout(self, m, ti):
        """{kind, size, align, hostSize, members: [{name, type, offset[, hostOffset]}]}."""
        if (m, ti) in self.lay:
            return self.lay[(m, ti)]
        recs = self.tables[m]
        bits, _, tl, nl, _ = struct_head(recs[ti])
        mem = host_members(recs, tl, nl)
        host_size = bits // 8
        is_bf = lambda t: t >= 512 and self.rec(m, t)[0] == 0x5C
        union = len(mem) > 1 and all(o == 0 for o, _, _ in mem) and not all(is_bf(t) for _, _, t in mem)
        out, off, align, i = [], 0, 1, 0
        self.lay[(m, ti)] = None  # recursion guard (a struct can't contain itself)
        while i < len(mem):
            hoff, name, mt = mem[i]
            if is_bf(mt):  # a run of bitfields sharing one storage unit
                j = i
                while j < len(mem) and mem[j][0] == hoff and is_bf(mem[j][2]):
                    j += 1
                gap = (mem[j][0] if j < len(mem) else host_size) - hoff
                unit = 1 if gap <= 1 else 2 if gap <= 2 else 4
                if not union:
                    off = -(-off // unit) * unit
                for k in range(i, j):
                    bd = self.rec(m, mem[k][2])
                    ln, p = num(bd, 1)
                    signed = bd[p] != 0x7C  # 0x7c: unsigned
                    pos, _ = num(bd, p + 1)
                    base = self.base(("" if signed else "unsigned ") +
                                     {1: "char", 2: "short", 4: "long"}[unit])
                    t = self.intern(("b", base, ln, pos),
                                    {"kind": "bitfield", "type": base, "bits": ln, "pos": pos})
                    out.append(self.member(mem[k][1], t, 0 if union else off, hoff))
                if not union:
                    off += unit
                align, i = max(align, unit), j
                continue
            s, a = self.natural(m, mt)
            t = self.ref(m, mt)
            if union:
                out.append(self.member(name, t, 0, hoff))
                off = max(off, s)
            else:
                off = -(-off // a) * a
                out.append(self.member(name, t, off, hoff))
                off += s
            align, i = max(align, a), i + 1
        L = {"kind": "union" if union else "struct", "size": -(-off // align) * align,
             "align": align, "hostSize": host_size, "members": out}
        self.lay[(m, ti)] = L
        return L

    @staticmethod
    def member(name, t, off, hoff):
        x = {"name": name, "type": t, "offset": off}
        if hoff != off:
            x["hostOffset"] = hoff
        return x


def convert(exe, module, arch, build, family="", note=""):
    """A 1991 debugger executable -> the vergiliplus doc (computed layouts)."""
    g = Graph(type_tables(exe))
    roots = {n: g.named(n) for n in sorted(g.defs) if NT_NAME.match(n) and n not in HOST_ONLY}
    g.settle()
    types = P.reachable(g.types, roots.values())
    # named structs the documented ones reach are kernel types too
    named = {n: g.ids[("N", n)] for n in sorted(g.defs)
             if ("N", n) in g.ids and g.ids[("N", n)] in types}
    if g.disagree:
        print("  ~~ %s: %d names defined differently across modules (first kept): %s"
              % (arch, len(g.disagree), ", ".join(sorted(g.disagree))), file=sys.stderr)
    return {
        "module": module, "arch": arch, "build": build, "family": family,
        "fileVersion": None, "pdb": None,
        "provenance": {"kind": "computed", "note": note},
        "named": named, "opaque": {}, "types": types,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("exe")
    ap.add_argument("--module", default="ntoskrnl")
    ap.add_argument("--arch", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--family", default="")
    ap.add_argument("--note", default="")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()
    doc = convert(a.exe, a.module, a.arch, a.build, a.family, a.note)
    if a.out:
        P.write(doc, a.out)
    else:
        json.dump(doc, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
