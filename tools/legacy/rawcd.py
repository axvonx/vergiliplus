#!/usr/bin/env python3
"""A raw CD image (BIN, MDF: 2352-byte sectors, or 2448 with subchannel) -> a plain
2048-byte-sector ISO that 7z reads. archive.org can't list inside these, so a manifest
entry fetches the whole image and converts it (the "rawcd" fetch step).

The layout is found from the volume descriptor at LBA 16 ("CD001", or High Sierra's
"CDROM"): sector size and the user data offset (16 for Mode 1, 24 for Mode 2 Form 1).

  rawcd.py IMAGE.bin OUT.iso
"""
import sys

LAYOUTS = [(2048, 0), (2352, 16), (2352, 24), (2448, 16), (2448, 24)]


def layout(f):
    for size, off in LAYOUTS:
        f.seek(16 * size + off)
        vd = f.read(8)
        if vd[1:6] in (b"CD001", b"CDROM") or vd[9:14] == b"CDROM":
            return size, off
    raise ValueError("no volume descriptor at LBA 16: not a CD image")


def convert(src, dst):
    with open(src, "rb") as f, open(dst, "wb") as g:
        size, off = layout(f)
        f.seek(0)
        while True:
            buf = f.read(size * 512)
            if not buf:
                break
            g.write(b"".join(buf[i + off:i + off + 2048] for i in range(0, len(buf) - size + 1, size)))


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
