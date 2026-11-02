#!/usr/bin/env python3
"""Cross-check a legacy doc against the offsets an i386-hosted kernel debugger
extension (KDEXTX86/ALP/MIP/PPC.DLL, NT 3.51/4.0 SUPPORT/DEBUG/I386) prints for
!processfields and !threadfields.

Each line there is dprintf("    Name:   0x%lx\\n", FIELD_OFFSET(EPROCESS, Name)), compiled
to `push imm ; push fmt`: the offsets are recovered from the code next to each format
string's address. A pair matches when _EPROCESS or _ETHREAD of the doc has that member
(index suffixes like "[0]" resolve to the member) at that offset; a name in neither struct
(the extension's !tokenfields, say) is unresolved, not a mismatch.

  kdext.py DOC.json KDEXT.DLL      -> "matched N/M", mismatches listed; exit 1 on any
"""
import json
import re
import struct
import sys

STRUCTS = ("_EPROCESS", "_ETHREAD")


def fields(path):
    """[(name, offset)] printed by the extension's !processfields / !threadfields."""
    b = open(path, "rb").read()
    pe = struct.unpack_from("<I", b, 0x3C)[0]
    nsec = struct.unpack_from("<H", b, pe + 6)[0]
    opt = pe + 24
    base = struct.unpack_from("<I", b, opt + 28)[0]
    secs = opt + struct.unpack_from("<H", b, pe + 20)[0]
    sections = [struct.unpack_from("<IIII", b, secs + 40 * i + 8) for i in range(nsec)]

    def va(off):
        for _, v, rs, rp in sections:
            if rp <= off < rp + rs:
                return base + v + off - rp
        return None

    out = []
    for m in re.finditer(rb"    ([A-Za-z0-9_\[\]]+): +0x%lx", b):
        fva = va(m.start())
        if fva is None:
            continue
        for p in (x.start() for x in re.finditer(re.escape(b"\x68" + struct.pack("<I", fva)), b)):
            if b[p - 2] == 0x6A:            # push imm8
                out.append((m.group(1).decode(), b[p - 1]))
            elif b[p - 5] == 0x68:          # push imm32
                out.append((m.group(1).decode(), struct.unpack_from("<I", b, p - 4)[0]))
    return out


def member_offsets(doc, struct_name):
    """{member name: offset} of a documented struct (top-level members)."""
    t = doc["types"]
    key = doc["named"].get(struct_name)
    if not key:
        return {}
    fl = t.get(t[key].get("fieldlist")) or {}
    return {m["name"]: m["offset"] for m in fl.get("members", [])}


def check(doc, dll):
    """(matched, resolved, unresolved, [(name, kdext offset, {struct: doc offset})])."""
    offs = {s: member_offsets(doc, s) for s in STRUCTS}
    bad, ok, unresolved = [], 0, 0
    for name, off in fields(dll):
        base = re.sub(r"\[\d+\]$", "", name)
        have = {s: offs[s][base] for s in STRUCTS if base in offs[s]}
        if not have:
            unresolved += 1
        elif off in have.values():
            ok += 1
        else:
            bad.append((name, off, have))
    return ok, ok + len(bad), unresolved, bad


def main():
    doc = json.load(open(sys.argv[1]))
    ok, n, unresolved, bad = check(doc, sys.argv[2])
    print("matched %d/%d (%d names in neither struct)" % (ok, n, unresolved))
    for name, off, have in bad:
        print("  %-32s kdext 0x%x  doc %s" % (name, off, {k: hex(v) for k, v in have.items()} or "-"))
    sys.exit(1 if bad or not n else 0)


if __name__ == "__main__":
    main()
