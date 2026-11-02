#!/usr/bin/env python3
"""sizeof(EPROCESS) / sizeof(ETHREAD) as a 1992-94 debugger reads them: the size pushed
right before each ReadVirtualMemory call whose failure prints "Unable to read _EPROCESS
at" / "_ETHREAD at".   kdsizes.py KD.EXE   (needs r2)"""
import json, re, subprocess, sys, collections
b = sys.argv[1]
def r2(c):
    return subprocess.run(["r2", "-q", "-e", "scr.color=0", "-c", "aaa 2>/dev/null; " + c, b], capture_output=True, text=True).stdout
strs = {r["vaddr"]: r["string"] for r in json.loads(r2("izj"))}
out = {}
for name in ("_EPROCESS", "_ETHREAD"):
    sizes = collections.Counter()
    for a, s in strs.items():
        if not s.startswith("Unable to read %s at" % name): continue
        for line in r2("axt %d" % a).splitlines():
            m = re.match(r"\S+ (0x[0-9a-f]+)", line)
            if not m: continue
            ops = json.loads(r2("pdj -60 @ %s" % m.group(1)) or "[]")
            imms = [int(x, 16) for o in ops for x in re.findall(r"^push (0x[0-9a-f]+)$", o.get("opcode", ""))]
            for v in imms:
                if 0x100 <= v <= 0x400: sizes[v] += 1
    out[name] = {hex(k): v for k, v in sizes.most_common()}
print(json.dumps(out))
