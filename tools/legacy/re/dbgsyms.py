#!/usr/bin/env python3
"""IMAGE_SEPARATE_DEBUG_HEADER (.dbg) COFF symbols -> radare2 flag script (f name @ va).
  dbgsyms.py X.DBG [imagebase] > flags.r2"""
import struct, sys
b = open(sys.argv[1], "rb").read()
sig, flags, mach, ch, ts, cksum, base, size, nsec, expsz, ddsz = struct.unpack_from("<HHHHIIIIIII", b, 0)
if len(sys.argv) > 2: base = int(sys.argv[2], 16)
secs = [struct.unpack_from("<8sIIII", b, 48 + 40 * i) for i in range(nsec)]  # name, vsize, va, rawsize, rawptr
o = 48 + nsec * 40 + expsz
for i in range(ddsz // 28):
    _, _, _, typ, sz, rva, ptr = struct.unpack_from("<IIHHIIII", b, o + 28 * i)[:7] if False else (None,)*3 + struct.unpack_from("<IIII", b, o + 28*i + 12)
    if typ != 1: continue
    nsyms, lva = struct.unpack_from("<II", b, ptr)
    st = ptr + lva; strtab = st + 18 * nsyms
    j = 0
    while j < nsyms:
        e = b[st + 18*j: st + 18*j + 18]
        if e[:4] == b"\0\0\0\0":
            so = struct.unpack_from("<I", e, 4)[0]; name = b[strtab+so: b.index(b"\0", strtab+so)].decode("latin1")
        else:
            name = e[:8].rstrip(b"\0").decode("latin1")
        val, secno, typ_, cls, naux = struct.unpack_from("<IhHBB", e, 8)
        if cls in (2, 3) and 0 < secno <= nsec and not name.startswith("."):
            va = base + val  # NT 3.x .dbg COFF values are image-relative
            clean = name.lstrip("_").split("@")[0]
            print("f sym.%s @ 0x%x" % (clean.replace("?", "_"), va))
        j += 1 + naux
