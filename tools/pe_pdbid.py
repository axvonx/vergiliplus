#!/usr/bin/env python3
"""Extract the CodeView (RSDS) PDB identity from a PE binary.

Prints the Microsoft symbol-server path for the module's PDB, i.e.
    <pdbname>/<GUID><AGE>/<pdbname>
plus the individual fields. Pure stdlib, no deps.

Usage: pe_pdbid.py <path-to-exe-or-dll>
"""
import sys
import struct


def extract(path):
    data = open(path, "rb").read()
    i = data.find(b"RSDS")
    while i != -1:
        guid = data[i + 4:i + 20]
        if len(guid) == 16:
            d1, d2, d3 = struct.unpack("<IHH", guid[:8])
            d4 = guid[8:16]
            age = struct.unpack_from("<I", data, i + 20)[0]
            end = data.find(b"\0", i + 24)
            name = data[i + 24:end].decode("latin1") if end != -1 else ""
            # Windows stores the full build path; the symbol server wants the basename.
            base = name.replace("\\", "/").split("/")[-1]
            if base.lower().endswith(".pdb") and 0 < age < 10000:
                guid_hex = "%08X%04X%04X%s" % (d1, d2, d3, d4.hex().upper())
                return {
                    "pdb": base,
                    "guid": guid_hex,
                    "age": age,
                    "sympath": "%s/%s%X/%s" % (base, guid_hex, age, base),
                }
        i = data.find(b"RSDS", i + 4)
    return None


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: pe_pdbid.py <pe>")
    info = extract(sys.argv[1])
    if not info:
        sys.exit("no RSDS CodeView record found in %s" % sys.argv[1])
    for k in ("pdb", "guid", "age", "sympath"):
        print("%s=%s" % (k.upper(), info[k]))


if __name__ == "__main__":
    main()
