#!/usr/bin/env python3
"""Recover struct field offsets from a 1992-96 kernel debugger's !process / !thread code.

Those commands get a copy of the EPROCESS / ETHREAD (pointer = the dump function's
first argument) and print fields with labelled printf formats. For each printf call,
the pushed arguments are traced back to [base + off] reads, and paired with the label
text before each % conversion. Output: JSON [{fmt, label, off, ins}] per function.

  kdproc.py BINARY "PROCESS %08lx" [more anchor strings...] > out.json   (needs r2)
"""
import json, re, subprocess, sys

def r2(binary, cmds):
    out = subprocess.run(["r2", "-q", "-e", "scr.color=0", "-e", "bin.relocs.apply=true",
                          "-c", "aaa 2>/dev/null; " + cmds, binary],
                         capture_output=True, text=True).stdout
    return out

def strings(binary):
    rows = json.loads(r2(binary, "izj") or "[]")
    return {r["vaddr"]: r["string"] for r in rows}

REG = r"(e[a-d]x|e[sd]i|ebp)"
MEM = re.compile(r"\[" + REG + r"(?: \+ (0x[0-9a-f]+|\d+))?\]")

def conv_labels(fmt):
    """[label] per % conversion (the text since the previous conversion, trimmed)."""
    parts = re.split(r"%[-+ #0]*\d*(?:\.\d+)?[lh]?[a-zA-Z]", fmt)
    labels = []
    for p in parts[:-1]:
        p = re.sub(r"\\n|\n", " ", p).strip(" :.,=()[]-\t")
        labels.append(p or (labels[-1] if labels else ""))
    return labels

def analyse(binary, func_addr, strs):
    ops = json.loads(r2(binary, "s %d; af; pdfj" % func_addr) or "{}").get("ops", [])
    # the struct copy is the first or second argument: keep whichever explains more reads
    return max((analyse_ops(ops, strs, src) for src in ("[ebp + 8]", "[ebp + 0xc]")), key=len)

def analyse_ops(ops, strs, base_src):
    base, regs, pushes, seg_refs, out = set(), {}, [], [], []
    for op in ops:
        d = op.get("opcode", ""); off_ins = op.get("addr") or 0
        m = re.match(r"(mov|movzx|movsx|lea) (\w+), (?:dword |word |byte )?(.*)$", d)
        if m:
            dst, src = m.group(2), m.group(3)
            if src == base_src and m.group(1) == "mov":
                base.add(dst); regs.pop(dst, None); continue
            mm = MEM.fullmatch(src)
            if mm and mm.group(1) in base and dst not in ("esp",):
                f = int(mm.group(2) or "0", 0)
                regs[dst] = f; seg_refs.append((f, off_ins)); base.discard(dst); continue
            base.discard(dst); regs.pop(dst, None)
        m = re.match(r"add (\w+), (0x[0-9a-f]+|\d+)$", d)
        if m and m.group(1) in base:
            base.discard(m.group(1)); regs[m.group(1)] = int(m.group(2), 0)
            seg_refs.append((regs[m.group(1)], off_ins)); continue
        m = re.match(r"push (?:dword )?(.*)$", d)
        if m:
            arg = m.group(1); val = None
            mm = MEM.fullmatch(arg)
            if mm and mm.group(1) in base:
                val = int(mm.group(2) or "0", 0); seg_refs.append((val, off_ins))
            elif arg in regs:
                val = regs[arg]
            s = None
            sm = re.match(r"str\.\S+|0x[0-9a-f]+$", arg)
            if op.get("ptr") in strs: s = strs[op["ptr"]]
            elif sm and sm.group(0).startswith("0x") and int(sm.group(0), 16) in strs: s = strs[int(sm.group(0), 16)]
            pushes.append((val, s, off_ins)); continue
        if d.startswith("call"):
            fmt_i = next((i for i in range(len(pushes) - 1, -1, -1) if pushes[i][1] and "%" in pushes[i][1]), None)
            if fmt_i is not None and fmt_i == len(pushes) - 1:
                fmt = pushes[fmt_i][1]; labels = conv_labels(fmt)
                args = list(reversed(pushes[:fmt_i]))
                used = set()
                for k, (val, s, ins) in enumerate(args):
                    if val is not None and k < len(labels):
                        out.append({"fmt": fmt.strip(), "label": labels[k], "off": val, "ins": hex(ins)}); used.add(val)
                for f, ins in seg_refs:  # fields read for this line but not pushed (times)
                    if f not in used and labels:
                        out.append({"fmt": fmt.strip(), "label": labels[0], "off": f, "ins": hex(ins), "indirect": True}); used.add(f)
                seg_refs = []
            pushes = []
            if not d.startswith("call") : continue
            for r in ("eax", "ecx", "edx"):
                regs.pop(r, None); base.discard(r)
    return out

def main():
    binary, anchors = sys.argv[1], sys.argv[2:]
    strs = strings(binary)
    result = {}
    for a in anchors:
        addr = next((v for v, s in strs.items() if s.startswith(a)), None)
        if addr is None:
            result[a] = None; continue
        fn = None
        for line in r2(binary, "axt %d" % addr).splitlines():
            m = re.match(r"(\S+) (0x[0-9a-f]+)", line)
            if m:
                o = r2(binary, "afo @ %s" % m.group(2)).strip()
                fn = int(o, 16) if o.startswith("0x") else None
                break
        result[a] = {"function": hex(fn) if fn else None, "fields": analyse(binary, fn, strs) if fn else []}
    json.dump(result, sys.stdout, indent=1)

if __name__ == "__main__":
    main()
