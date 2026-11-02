#!/usr/bin/env python3
"""Read one file out of a High Sierra CD image (the 1986 pre-ISO 9660 format of early
CDs like the October 1991 NT pre-release, which 7-Zip and archive.org cannot open).
Same directory records as ISO 9660, with the volume descriptor tagged "CDROM", the root
record at 180 (ISO: 156), flags at 24 (ISO: 25) and the name length at 32.

  hsfs.py IMAGE PATH/IN/IMAGE OUT
"""
import struct
import sys

SECTOR = 2048


def extract(image, path):
    """bytes of the file at `path` (case-insensitive, "/"-separated)."""
    want = [p.upper() for p in path.strip("/").split("/")]
    with open(image, "rb") as f:
        def read(lbn, n):
            f.seek(lbn * SECTOR)
            return f.read(n)

        pvd = read(16, SECTOR)
        if pvd[9:14] != b"CDROM":
            raise ValueError("%s is not a High Sierra image" % image)
        rec = pvd[180:180 + 34]
        for depth, part in enumerate(want):
            lbn, size = struct.unpack_from("<I", rec, 2)[0], struct.unpack_from("<I", rec, 10)[0]
            data, o, found = read(lbn, size), 0, None
            while o < len(data):
                ln = data[o]
                if ln == 0:  # records don't cross sectors: skip to the next one
                    o = (o // SECTOR + 1) * SECTOR
                    continue
                r = data[o:o + ln]
                o += ln
                name = r[33:33 + r[32]].decode("latin1").split(";")[0].rstrip(".").upper()
                if name == part:
                    found = r
                    break
            if found is None:
                raise FileNotFoundError("%s not in %s" % ("/".join(want[:depth + 1]), image))
            rec = found
        if rec[24] & 2:
            raise IsADirectoryError(path)
        return read(struct.unpack_from("<I", rec, 2)[0], struct.unpack_from("<I", rec, 10)[0])


def main():
    with open(sys.argv[3], "wb") as f:
        f.write(extract(sys.argv[1], sys.argv[2]))


if __name__ == "__main__":
    main()
