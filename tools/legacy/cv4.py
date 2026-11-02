#!/usr/bin/env python3
"""CodeView 4 types in COFF libraries/objects (.debug$T) -> a vergiliplus doc.

Before Windows 2000 SP3 no public symbol file carries kernel types; the DDK's import
and static libraries do (LIBCNTPR.LIB: every object compiled with /Z7 carries its own
type table). Each object's table is separate (indices restart at 0x1000), so the
tables are merged into one graph:

- a named struct/union/enum is one node per name. Its definition is the one most
  objects agree on (then the one with most members); disagreeing definitions are
  reported (they come from the C runtime's own headers, e.g. excpt.h's lowercase
  _EXCEPTION_RECORD), never mixed in;
- everything else (pointers, arrays, modifiers, bitfields, procedures, anonymous
  aggregates) is hash-consed by structure, so identical records share an index.

Leaves are read by pdb_to_json.cv_records (16-bit CodeView 4 leaves and the 32-bit
_ST ones of VC 4-6). Output nodes are the ones pdb_to_json.convert() writes.

  cv4.py LIB [LIB ...] --machine i386 --module ntoskrnl --arch x86 --build 4.0.1381.1
         [--family F] [--note N] [-o out.json]
"""
import argparse
import collections
import json
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import pdb_to_json as P  # noqa: E402

MACHINES = {"i386": 0x14C, "mips": 0x166, "alpha": 0x184, "ppc": 0x1F0}
# MSVC 2.x-6 name every anonymous aggregate "__unnamed"; the site's convention (and
# llvm-pdbutil's for later PDBs) is "<unnamed-tag>", which layout inlines
ANON = ("__unnamed", "<unnamed-tag>", "(untagged)")


def ar_members(b):
    """(name, bytes) of each member of a COFF archive ("!<arch>\\n")."""
    o = 8
    while o + 60 <= len(b):
        hdr = b[o:o + 60]
        size = int(hdr[48:58].decode("latin1").strip() or 0)
        yield hdr[:16].decode("latin1").strip(), b[o + 60:o + 60 + size]
        o += 60 + size + (size & 1)


def coff_type_tables(obj, machine):
    """The .debug$T type tables of one COFF object built for `machine` (else [])."""
    if len(obj) < 20:
        return []
    mach, nsec = struct.unpack_from("<HH", obj, 0)
    if mach != machine or nsec > 2000:
        return []
    opt = struct.unpack_from("<H", obj, 16)[0]
    out = []
    for i in range(nsec):
        s = 20 + opt + 40 * i
        size, ptr = struct.unpack_from("<II", obj, s + 16)
        if obj[s:s + 8].rstrip(b"\0") == b".debug$T" and ptr and size > 4 \
                and struct.unpack_from("<I", obj, ptr)[0] in (1, 2, 4):  # CV4 signatures
            out.append(obj[ptr + 4:ptr + size])
    return out


def type_tables(path, machine):
    """[(object name, {hex index: node})] of a .lib or .obj, for one machine."""
    b = open(path, "rb").read()
    objs = ar_members(b) if b.startswith(b"!<arch>\n") else [(os.path.basename(path), b)]
    out = []
    for name, obj in objs:
        if obj[:4] == b"\0\0\xff\xff":  # import-library short member
            continue
        for blob in coff_type_tables(obj, machine):
            out.append((name, P.cv_records(blob)))
    return out


def shape(tbl, key):
    """(size, ((member, offset), ...)) of an aggregate definition, for agreement checks."""
    n = tbl[key]
    fl = tbl.get(n.get("fieldlist")) or {}
    return (n.get("size"), tuple((m["name"], m["offset"]) for m in fl.get("members", [])),
            tuple((e["name"], e["value"]) for e in fl.get("enums", [])))


class Merger:
    def __init__(self, tables):
        self.tables = tables
        self.types, self.ids = {}, {}
        self.next = 0x1000
        # every definition of every named aggregate: (kind, name) -> [(table#, key)]
        self.defs = collections.defaultdict(list)
        for i, (_, tbl) in enumerate(tables):
            for k, n in tbl.items():
                if n["kind"] in ("struct", "union", "enum") and n.get("fieldlist") \
                        and n.get("name") not in ANON:
                    self.defs[(n["kind"], n["name"])].append((i, k))
        self.chosen, self.disagree = {}, {}
        for nk, cands in self.defs.items():
            votes = collections.Counter(shape(tables[i][1], k) for i, k in cands)
            best = max(votes, key=lambda s: (votes[s], len(s[1]) + len(s[2])))
            self.chosen[nk] = next((i, k) for i, k in cands if shape(tables[i][1], k) == best)
            if len(votes) > 1:
                self.disagree[nk[1]] = {"kept": votes[best], "others": sum(votes.values()) - votes[best]}

    def intern(self, skey, node):
        if skey not in self.ids:
            idx = P.hexi(self.next)
            self.next += 1
            self.ids[skey] = idx
            self.types[idx] = node
        return self.ids[skey]

    def named(self, kind, name):
        """The one node of a named aggregate (definition chosen across all tables)."""
        skey = ("N", kind, name)
        if skey in self.ids:
            return self.ids[skey]
        node = {"kind": kind, "name": name, "fieldlist": None, "forward": None}
        if kind != "enum":
            node["size"] = 0
        idx = self.intern(skey, node)
        if (kind, name) in self.chosen:  # fill after interning: members may refer back
            i, k = self.chosen[(kind, name)]
            src = self.tables[i][1][k]
            if kind != "enum":
                node["size"] = src.get("size", 0)
            node["fieldlist"] = self.fieldlist(i, src["fieldlist"])
        return idx

    def fieldlist(self, i, key):
        fl = self.tables[i][1].get(key) or {"members": [], "enums": []}
        members = [{"name": m["name"], "type": self.ref(i, m["type"]), "offset": m["offset"]}
                   for m in fl.get("members", [])]
        enums = [dict(e) for e in fl.get("enums", [])]
        skey = ("F", json.dumps(members), json.dumps(enums))
        return self.intern(skey, {"kind": "fieldlist", "members": members, "enums": enums})

    def ref(self, i, key):
        """Global index of table i's type `key`."""
        if key is None:
            return None
        ti = int(key, 16)
        if ti < 0x1000:
            if key not in self.types:
                name = P.cv_simple_name(ti)
                self.types[key] = {"kind": "base", "name": name} if name else {"kind": "other"}
            return key
        n = self.tables[i][1].get(key)
        if n is None:
            return self.intern(("?", key), {"kind": "other"})
        k = n["kind"]
        if k in ("struct", "union", "enum"):
            if n.get("name") not in ANON:
                return self.named(k, n["name"])
            fl = self.fieldlist(i, n["fieldlist"]) if n.get("fieldlist") else None
            node = {"kind": k, "name": "<unnamed-tag>", "fieldlist": fl, "forward": None}
            if k != "enum":
                node["size"] = n.get("size", 0)
            return self.intern(("A", k, node.get("size"), fl), node)
        if k == "pointer":
            r = self.ref(i, n["referent"])
            return self.intern(("p", r), {"kind": "pointer", "referent": r})
        if k == "modifier":
            r = self.ref(i, n["referent"])
            return self.intern(("m", r, n["const"], n["volatile"]),
                               {"kind": "modifier", "referent": r,
                                "const": n["const"], "volatile": n["volatile"]})
        if k == "array":
            e = self.ref(i, n["element"])
            return self.intern(("a", e, n["bytes"]), {"kind": "array", "element": e, "bytes": n["bytes"]})
        if k == "bitfield":
            t = self.ref(i, n["type"])
            return self.intern(("b", t, n["bits"], n["pos"]),
                               {"kind": "bitfield", "type": t, "bits": n["bits"], "pos": n["pos"]})
        if k == "proc":
            r, a = self.ref(i, n["return"]), self.ref(i, n["args"])
            return self.intern(("f", r, a), {"kind": "proc", "return": r, "args": a})
        if k == "arglist":
            args = [self.ref(i, a) for a in n["args"]]
            return self.intern(("l",) + tuple(args), {"kind": "arglist", "args": args})
        return self.intern(("o", n.get("lf")), {"kind": "other", "lf": n.get("lf")})


def doc_shape(doc, name):
    """shape() of a doc's named type, or None."""
    t, k = doc["types"], doc["named"].get(name)
    return shape(t, k) if k else None


def matching_tables(doc, tables, names):
    """The tables (object name, records) whose definitions of every one of `names` agree
    with the doc's member for member: how an object of a mixed-architecture library
    (the SDK's CRASHLIB.LIB holds every CPU's crash-dump structures, compiled on i386)
    is assigned to the doc's architecture."""
    out = []
    for obj, tbl in tables:
        defs = {n["name"]: k for k, n in tbl.items()
                if n["kind"] in ("struct", "union") and n.get("fieldlist")}
        if all(n in defs and shape(tbl, defs[n]) == doc_shape(doc, n) for n in names):
            out.append((obj, tbl))
    return out


def convert(paths, machine, module, arch, build, family="", note="", names=None, extra=()):
    """One or more COFF libraries/objects -> the vergiliplus doc for module x build x arch.
    `names` (optional) limits the documented types; everything they reach comes along.
    `extra`: more (object, records) tables merged in (see matching_tables); the library's
    own definitions outvote theirs."""
    mach = MACHINES[machine] if isinstance(machine, str) else machine
    tables = [t for p in paths for t in type_tables(p, mach)] + list(extra)
    if not tables:
        raise ValueError("no CodeView types for machine 0x%x in %s" % (mach, ", ".join(paths)))
    m = Merger(tables)
    named, declared = {}, {}
    for (kind, name) in sorted(m.chosen):
        if names is None or name in names:
            named[name] = m.named(kind, name)
    # every named aggregate any table mentions without defining: opaque
    for _, tbl in tables:
        for n in tbl.values():
            if n["kind"] in ("struct", "union", "enum") and n.get("name") \
                    and n["name"] not in ANON and (n["kind"], n["name"]) not in m.chosen:
                declared.setdefault(n["name"], n["kind"])
    types = P.reachable(m.types, named.values())
    if names is not None:  # what the chosen roots reach is documented too
        named = {n: m.ids[("N", k, n)] for (k, n) in sorted(m.chosen)
                 if ("N", k, n) in m.ids and m.ids[("N", k, n)] in types}
    # an opaque name a documented type reaches (as a pointer target, say) is kept
    opaque = {n: k for n, k in sorted(declared.items())
              if n not in named and ("N", k, n) in m.ids and m.ids[("N", k, n)] in types}
    if m.disagree:
        print("  ~~ %s: %d names with disagreeing definitions (majority kept): %s"
              % (arch, len(m.disagree), ", ".join(sorted(m.disagree))), file=sys.stderr)
    return {
        "module": module, "arch": arch, "build": build, "family": family,
        "fileVersion": None, "pdb": None,
        "provenance": {"kind": "source", "note": note},
        "named": named, "opaque": opaque, "types": types,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("libs", nargs="+")
    ap.add_argument("--machine", required=True, choices=sorted(MACHINES))
    ap.add_argument("--module", required=True)
    ap.add_argument("--arch", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--family", default="")
    ap.add_argument("--note", default="")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()
    doc = convert(a.libs, a.machine, a.module, a.arch, a.build, a.family, a.note)
    if a.out:
        P.write(doc, a.out)
    else:
        json.dump(doc, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
