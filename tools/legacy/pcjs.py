#!/usr/bin/env python3
"""A PCjs disk image (JSON: diskData[cylinder][head][sector]) -> the raw sector image.

Each sector is {"c", "h", "s" (1-based), "l" (length), "d": [int32, ...]}: little-endian
32-bit words, and a short array repeats its last word up to the sector length. The JSON
records the image's md5 (imageInfo.hash); the result is checked against it.

  pcjs.py DISK.json OUT.img
"""
import hashlib
import json
import struct
import sys


def image(disk):
    """bytes of a PCjs disk (the parsed JSON)."""
    out = bytearray()
    for cyl in disk["diskData"]:
        for head in cyl:
            for sec in sorted(head, key=lambda s: s["s"]):
                n = sec.get("l", 512)
                words = sec.get("d") or [0]
                words = words + [words[-1]] * (n // 4 - len(words))
                out += struct.pack("<%di" % (n // 4), *words[:n // 4])
    want = disk.get("imageInfo", {}).get("hash")
    if want and hashlib.md5(out).hexdigest() != want:
        raise ValueError("PCjs image md5 %s, JSON says %s" % (hashlib.md5(out).hexdigest(), want))
    return bytes(out)


def main():
    with open(sys.argv[1]) as f:
        img = image(json.load(f))
    with open(sys.argv[2], "wb") as f:
        f.write(img)


if __name__ == "__main__":
    main()
