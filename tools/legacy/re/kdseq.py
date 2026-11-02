#!/usr/bin/env python3
"""The ordered struct-field reads of a debugger's !thread (or !process) dump function:
[(shape, offset)], shape = instruction with the offset blanked. Same source compiled
against different headers gives the same shapes in the same order, so a name annotated
on one build transfers to another by position.   kdseq.py KD.EXE "anchor" (needs r2)"""
import json, re, subprocess, sys
b, anchor = sys.argv[1], sys.argv[2]
def r2(c): return subprocess.run(["r2","-q","-e","scr.color=0","-c","aaa 2>/dev/null; "+c,b],capture_output=True,text=True).stdout
strs = {r["vaddr"]: r["string"] for r in json.loads(r2("izj"))}
a = next(v for v, s in strs.items() if s.startswith(anchor))
site = re.match(r"\S+ (0x[0-9a-f]+)", r2("axt %d" % a)).group(1)
fn = int(r2("afo @ %s" % site).strip(), 16)
ops = json.loads(r2("s %d; af; pdfj" % fn))["ops"]
best = []
for src in ("[ebp + 8]", "[ebp + 0xc]"):
    base, seq = set(), []
    for o in ops:
        d = o.get("opcode", "")
        m = re.match(r"(\w+) (\w+), (?:dword |word |byte )?(.*)$", d)
        if m and m.group(1) == "mov" and m.group(3) == src:
            base.add(m.group(2)); continue
        mm = re.search(r"\[(e[a-d]x|e[sd]i)(?: \+ (0x[0-9a-f]+))?\]", d)
        if mm and mm.group(1) in base:
            seq.append((re.sub(r"\+ 0x[0-9a-f]+\]", "+ X]", d), int(mm.group(2) or "0", 16), hex(o["addr"])))
        ma = re.match(r"add (e[a-d]x), (0x[0-9a-f]+)$", d)
        if ma and ma.group(1) in base:
            seq.append(("add R, X", int(ma.group(2), 16), hex(o["addr"])))
        if m and m.group(2) in base and m.group(3) != src: base.discard(m.group(2))
        if d.startswith("call"): base -= {"eax", "ecx", "edx"}
    if len(seq) > len(best): best = seq
# each read's context: the next string literal the code references (its role's anchor)
addrs = [o["addr"] for o in ops]
def lit(o):
    for x in re.findall(r"0x[0-9a-f]+", o.get("opcode", "")):
        if int(x, 16) in strs: return strs[int(x, 16)]
    return None
lits = [lit(o) for o in ops]
out = []
for sh, off, ins in best:
    i = addrs.index(int(ins, 16))
    nxt = next((lits[k] for k in range(i, len(ops)) if lits[k]), None)
    out.append((sh, off, ins, nxt))
print(json.dumps({"function": hex(fn), "seq": out}))
