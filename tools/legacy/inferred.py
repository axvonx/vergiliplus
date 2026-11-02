#!/usr/bin/env python3
"""An inferred-layout spec (data/inferred/*.json) -> a vergiliplus doc.

Inferred layouts are reverse-engineered, not recorded: no type record of them exists in
anything Microsoft published. A spec lists, per struct, the members recovered (name,
type as a C type string, offset, and the instruction that is the evidence), the size,
a confidence and the basis of the inference. The research tooling that writes specs
(radare2 over the NT 3.1-era kernel debuggers' !process / !thread code) lives outside
the repo; the spec is the reviewable artifact.

Members of embedded structs keep dotted names (Pcb.DirectoryTableBase): the embedded
struct's extent isn't known, so it isn't invented. Structs named by a member type but
not inferred (_LIST_ENTRY, _KPROCESS*, ...) are opaque, sized where it matters.
"""
import json
import re
import sys

# sizes of the non-inferred types an inferred member may embed by value
EMBEDDED = {("struct", "_LIST_ENTRY"): 8, ("union", "_LARGE_INTEGER"): 8}


class Builder:
    def __init__(self):
        self.types, self.ids, self.next, self.opaque = {}, {}, 0x1000, {}

    def intern(self, key, node):
        if key not in self.ids:
            self.ids[key] = "0x%X" % self.next
            self.next += 1
            self.types[self.ids[key]] = node
        return self.ids[key]

    def type(self, s):
        """C type string ("unsigned long", "struct _KPROCESS*", "unsigned char[16]")."""
        s = s.strip()
        m = re.fullmatch(r"(.+)\[(\d+)\]", s)
        if m:
            el = self.type(m.group(1))
            return self.intern(("a", el, int(m.group(2))),
                               {"kind": "array", "element": el,
                                "bytes": int(m.group(2)) * self.size(m.group(1))})
        if s.endswith("*"):
            r = self.type(s[:-1])
            return self.intern(("p", r), {"kind": "pointer", "referent": r})
        m = re.fullmatch(r"(struct|union) (\w+)", s)
        if m:
            kind, name = m.groups()
            self.opaque[name] = kind
            node = {"kind": kind, "name": name, "fieldlist": None, "forward": None,
                    "size": EMBEDDED.get((kind, name), 0)}
            return self.intern(("o", kind, name), node)
        return self.intern(("b", s), {"kind": "base", "name": s})

    @staticmethod
    def size(s):
        return {"char": 1, "unsigned char": 1, "short": 2, "unsigned short": 2}.get(s.strip(), 4)


def convert(spec):
    """The spec (parsed JSON) -> doc."""
    b, named = Builder(), {}
    for name, st in spec["structs"].items():
        members = [{"name": m["name"], "type": b.type(m["type"]), "offset": m["offset"],
                    "evidence": m["evidence"]} for m in st["members"]]
        fl = b.intern(("F", name), {"kind": "fieldlist", "members": members, "enums": []})
        named[name] = b.intern(("S", name), {
            "kind": "struct", "name": name, "size": st["size"], "fieldlist": fl, "forward": None,
            "inferred": {"confidence": st["confidence"], "basis": st["basis"]}})
    doc = {
        "module": spec["module"], "arch": spec["arch"], "build": spec["build"],
        "family": spec.get("family", ""), "fileVersion": None, "pdb": None,
        "provenance": {"kind": "inferred", "note": spec["note"]},
        "named": named,
        "opaque": {n: k for n, k in sorted(b.opaque.items()) if n not in named},
        "types": b.types,
    }
    for k in ("buildLabel", "incomplete"):
        if spec.get(k):
            doc[k] = spec[k]
    return doc


def main():
    json.dump(convert(json.load(open(sys.argv[1]))), sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
