#!/usr/bin/env python3
"""MS-DOS COMPRESS.EXE (SZDD) files: NT 3.x setup media store most binaries so (NTOSKRNL.EX_).

LZSS with a 4 KB window that starts filled with spaces, write position 4096-16; each
flag byte's bits (LSB first) mark a literal (1) or a 2-byte back-reference (0: 12-bit
window position, 4-bit length - 3).

  szdd.py FILE.EX_ OUT
"""
import struct
import sys

MAGIC = b"SZDD\x88\xf0\x27\x33"


def expand(b):
    if b[:8] != MAGIC:
        raise ValueError("not an SZDD file")
    size = struct.unpack_from("<I", b, 10)[0]
    win, pos, out, i, n = bytearray(b" " * 4096), 4096 - 16, bytearray(), 14, len(b)
    while i < n and len(out) < size:
        flags, i = b[i], i + 1
        for bit in range(8):
            if i >= n:
                break
            if flags >> bit & 1:
                c, i = b[i], i + 1
                out.append(c)
                win[pos], pos = c, (pos + 1) & 4095
                continue
            if i + 1 >= n:
                break
            src, ln, i = b[i] | (b[i + 1] & 0xF0) << 4, (b[i + 1] & 0x0F) + 3, i + 2
            for k in range(ln):
                c = win[(src + k) & 4095]
                out.append(c)
                win[pos], pos = c, (pos + 1) & 4095
    return bytes(out[:size])


if __name__ == "__main__":
    with open(sys.argv[1], "rb") as f, open(sys.argv[2], "wb") as g:
        g.write(expand(f.read()))
