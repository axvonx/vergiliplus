#!/usr/bin/env python3
"""Type names a debug build's own C expression text names (ASSERT strings) -> attested names.

A checked kernel embeds each failed-ASSERT expression as a string, Microsoft's source text
verbatim. Three of its forms name a type for certain:

  sizeof(X)                X is a type
  FIELD_OFFSET(X, A.B)     X is a struct (or union) type; A.B names its members
  (PX)expr, (PX )*expr     a cast: C can't cast to an aggregate, so a cast names a scalar
                           or a pointer type; PX (NT's pointer-typedef convention) names X

Only NT-style names count (upper case, digits, underscores); a cast whose name has no P
prefix, or names a base typedef (PULONG, NTSTATUS), is a scalar and dropped. Nothing is
inferred from variables (`Process->Pcb` says nothing certain about Process's type).

  strnames.py EXE...       -> {name: {"how", "text", "file", ["members"]}} as JSON
"""
import json
import os
import re
import sys

ID = r"[A-Z][A-Z0-9_]{2,}"
CAST = re.compile(r"\(\s*(P" + ID + r")\s*\)\s*(?=[A-Z(&*])")
SIZEOF = re.compile(r"sizeof\s*\(\s*(" + ID + r")\s*\)")
FOFF = re.compile(r"FIELD_OFFSET\s*\(\s*(" + ID + r")\s*,\s*([A-Za-z_][\w.\[\]]*)\s*\)")
# Windows / NT base typedefs: scalars, never an aggregate's name
BASE = set("""VOID CHAR UCHAR SHORT USHORT LONG ULONG INT UINT BOOL BOOLEAN BYTE WORD DWORD
WCHAR TCHAR CCHAR CSHORT CLONG FLOAT DOUBLE NTSTATUS KIRQL KPROCESSOR_MODE HANDLE LPSTR
LPWSTR LPVOID LPBYTE PSZ SZ STR WSTR LARGE_INTEGER QUAD ACCESS_MASK LCID LANGID HRESULT SIZE_T""".split())
HOW_ORDER = ("FIELD_OFFSET", "sizeof", "cast")


def strings(b, n=6):
    for m in re.finditer(rb"[\x20-\x7e]{%d,}" % n, b):
        yield m.group().decode()


def names(paths, labels=None):
    """{name: {"how", "text", "file"[, "members"]}}: the strongest form wins
    (FIELD_OFFSET > sizeof > cast), its first expression is the evidence. `labels` name
    each file ("file"; default: its base name)."""
    out = {}

    def hit(name, how, text, f, member=None):
        if how == "cast":
            name = name[1:]
        if name in BASE or (name[0] == "P" and name[1:] in BASE):  # PVOID, PULONG
            return
        cur = out.get(name)
        if not cur or HOW_ORDER.index(how) < HOW_ORDER.index(cur["how"]):
            out[name] = cur = dict(cur or {}, how=how, text=text, file=f)
        if member:
            ms = cur.setdefault("members", [])
            if member not in ms:
                ms.append(member)

    for path, f in zip(paths, labels or [os.path.basename(p) for p in paths]):
        with open(path, "rb") as fh:
            b = fh.read()
        for s in strings(b):
            for m in FOFF.finditer(s):
                hit(m.group(1), "FIELD_OFFSET", s, f, m.group(2))
            for m in SIZEOF.finditer(s):
                hit(m.group(1), "sizeof", s, f)
            for m in CAST.finditer(s):
                hit(m.group(1), "cast", s, f)
    for v in out.values():
        if "members" in v:
            v["members"].sort()
    return dict(sorted(out.items()))


def main():
    json.dump(names(sys.argv[1:]), sys.stdout, indent=1)


if __name__ == "__main__":
    main()
