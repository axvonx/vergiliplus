#!/usr/bin/env python3
"""Inferred EPROCESS / ETHREAD layouts of NT 3.1-era builds, from the kernel debugger's
own !process / !thread code (kdproc.py labels, kdseq.py read sequences, kdsizes.py), as
vergiliplus spec files (data/inferred/*.json; tools/legacy/inferred.py builds docs).

Names are NT 3.51's (its KDEXT !processfields / !threadfields), carried back by meaning:
a printf label for !process; for !thread, each read's role from the string the code
references next (the state switch, "Alertable", "unable to get Wait object", ...). Members of embedded
structs are flattened with dotted names (Pcb.DirectoryTableBase): their extents aren't
known. Types come from the access width and use.

  infer_gen.py OUTDIR      (reads the extraction JSONs from $KDJSON)
"""
import json, os, re, sys

KDJSON = os.environ.get("KDJSON", ".")

# !process printf label -> (member, type); per-label value is the member's offset
PROC = {
    "Cid": ("UniqueProcessId", "void*"),
    "ParentCid": ("InheritedFromUniqueProcessId", "void*"),
    "DirBase": ("Pcb.DirectoryTableBase", "unsigned long"),
    "ObjectTable": ("ObjectTable", "void*"),
    "Image": ("ImageFileName", "unsigned char[16]"),
    "VadRoot": ("VadRoot", "void*"),
    "Clone Root": ("CloneRoot", "void*"),
    "Private Page Count": ("NumberOfPrivatePages", "unsigned long"),
    "Private Pages": ("NumberOfPrivatePages", "unsigned long"),
    "Modified Pages": ("ModifiedPageCount", "unsigned long"),
    "OwningThread": ("ProcessMutant.OwnerThread", "struct _KTHREAD*"),
    "ElapsedTime": ("CreateTime", "union _LARGE_INTEGER"),
    "UserTime": ("Pcb.UserTime", "union _LARGE_INTEGER"),
    "KernelTime": ("Pcb.KernelTime", "union _LARGE_INTEGER"),
    "QuotaPeakPoolUsage[NonPagedPool": ("QuotaPeakPoolUsage", "unsigned long[2]"),
    "QuotaPoolUsage[NonPagedPool": ("QuotaPoolUsage", "unsigned long[2]"),
    "Current Working Set Size": ("Vm.WorkingSetSize", "unsigned long"),
    "PageFaultCount": ("Vm.PageFaultCount", "unsigned long"),
    "PeakWorkingSetSize": ("Vm.PeakWorkingSetSize", "unsigned long"),
    "PeakVirtualSize": ("PeakVirtualSize", "unsigned long"),
    "CommitCharge": ("CommitCharge", "unsigned long"),
}
# the [1] element of a [2] array: must sit 4 bytes after [0]
PAIRS = {"QuotaPeakPoolUsage[PagedPool": "QuotaPeakPoolUsage[NonPagedPool",
         "QuotaPoolUsage[PagedPool": "QuotaPoolUsage[NonPagedPool"}

# !thread: each read's role from the next string the code references after it (kdseq.py)
# (anchor prefix, member, default type); "#n" = the n-th read under that anchor
THREAD = [
    ("TYPE mismatch", "Tcb.Header.Type", "short"),
    ("%sTHREAD %lx  Cid#0", "Cid.UniqueThread", "void*"),   # pushed last arg first
    ("%sTHREAD %lx  Cid#1", "Cid.UniqueProcess", "void*"),
    ("INITIALIZED", "Tcb.State", "char"),
    ("Non-Alertable", "Tcb.Alertable", "unsigned char"),
    ("UserMode", "Tcb.WaitMode", "char"),
    (" (%s) %s %s", "Tcb.WaitReason", "unsigned char"),
    ("SuspendCount", "Tcb.SuspendCount", "char"),
    ("FreezeCount", "Tcb.FreezeCount", "char"),
    ("unable to get Wait object", "Tcb.WaitBlockList", "struct _KWAIT_BLOCK*"),
    ("%sMutexLevel", "Tcb.MutexLevel", "unsigned long"),
    ("%sMutexListHead", "Tcb.MutexListHead", "struct _LIST_ENTRY"),
    ("%sLPC Messages", "LpcMessages", "void*"),
    ("%sIRP List#min", "IrpList", "struct _LIST_ENTRY"),
    ("%sOwning Process", "Tcb.ApcState.Process", "struct _KPROCESS*"),
    ("%sWaitTime", "Tcb.WaitTime", "unsigned long"),
    ("%sUserTime", "Tcb.UserTime", "union _LARGE_INTEGER"),
    ("%sKernelTime", "Tcb.KernelTime", "union _LARGE_INTEGER"),
    ("%sStart Address", "StartAddress", "void*"),
    ("%sWin32 Start Address", "Win32StartAddress", "void*"),
    ("%sInitial Sp#0", "Tcb.KernelStack", "void*"),         # "Initial Sp %lx Current Sp %lx"
    ("%sInitial Sp#1", "Tcb.InitialStack", "void*"),
    ("Kernel stack not resident#0", "Tcb.KernelStackResident", "unsigned char"),
]
# the priority line's labels, in format order (reads come last argument first)
PRIO = {"Priority": ("Tcb.Priority", "char"), "BasePriority": ("Tcb.BasePriority", "char"),
        "PriorityDecrement": ("Tcb.PriorityDecrement", "char"),
        "DecrementCount": ("Tcb.DecrementCount", "unsigned char")}

def load(name):
    with open(os.path.join(KDJSON, name + ".json")) as f:
        return json.load(f)

def proc_members(kdproc):
    out, offs = {}, {}
    fields = kdproc["PROCESS %08lx"]["fields"]
    for f in fields:
        offs.setdefault(f["label"], (f["off"], f["ins"]))
    for lab, (name, ty) in PROC.items():
        if lab in offs:
            out[name] = {"name": name, "type": ty, "offset": offs[lab][0], "evidence": offs[lab][1]}
    for hi, lo in PAIRS.items():  # [1] at [0] + 4, or the array claim is wrong
        if hi in offs and lo in offs and offs[hi][0] != offs[lo][0] + 4:
            raise ValueError("%s not 4 after %s" % (hi, lo))
    return out

def width_type(shape, ty):
    """The access width wins over a role's default type (State was a dword in 1992)."""
    if " byte " in shape:
        return ty if ty in ("char", "unsigned char") else ("unsigned char" if "movzx" in shape else "char")
    if " word " in shape:
        return "short"
    if " dword " in shape and ty in ("char", "unsigned char", "short"):
        return "unsigned long"
    return ty

def thread_members(seq):
    """Members of a build's !thread reads by anchor; a role whose reads disagree is
    dropped."""
    groups = {}
    for sh, off, ins, nxt in seq:
        if nxt:
            groups.setdefault(nxt, []).append((sh, off, ins))
    cand = {}
    def put(name, ty, sh, off, ins):
        cand.setdefault(name, []).append((width_type(sh, ty), off, ins))
    for key, name, ty in THREAD:
        anchor, _, sel = key.partition("#")
        g = next((v for k, v in groups.items() if k.startswith(anchor)), None)
        if not g:
            continue
        if sel == "min":
            sh, off, ins = min(g, key=lambda r: r[1]); put(name, ty, sh, off, ins)
        elif sel:
            if int(sel) < len(g):
                put(name, ty, *g[int(sel)])
        else:
            for r in g: put(name, ty, *r)
    g = next((v for k, v in groups.items() if k.startswith("%sPriority")), None)
    if g:
        fmt = next(k for k in groups if k.startswith("%sPriority"))
        labels = re.findall(r"([A-Za-z]+) %ld", fmt.replace("%s", ""))
        for (sh, off, ins), lab in zip(g, reversed(labels)):
            if lab in PRIO: put(PRIO[lab][0], PRIO[lab][1], sh, off, ins)
    out = {}
    for name, rows in cand.items():
        offs = {r[1] for r in rows}
        if len(offs) == 1:
            ty, off, ins = rows[0]
            out[name] = {"name": name, "type": ty, "offset": off, "evidence": ins}
        else:
            print("  ~~ dropped %s: reads at %s" % (name, sorted(map(hex, offs))), file=sys.stderr)
    return out

def main():
    outdir = sys.argv[1]
    cfg = load("builds")  # [{key, build, buildLabel?, family, arch, kd, source:{lib,sha256}}]
    for c in cfg:
        p = proc_members(load("%s-%s" % (c["key"], c["kd"])))
        t = thread_members(load("seq/%s-%s-t" % (c["key"], c["kd"]))["seq"])
        for x in c.get("kernel", []):  # reads confirmed in the kernel's own code
            p[x["name"]] = x
        sizes = load("sizes/%s-%s" % (c["key"], c["kd"]))
        conf_p = "high" if c.get("kernel") else "medium"
        spec = {k: c[k] for k in ("module", "arch", "build", "buildLabel", "family", "incomplete") if c.get(k)}
        spec["source"] = c["source"]
        spec["note"] = c["note"]
        spec["structs"] = {
            "_EPROCESS": {"size": int(max(sizes["_EPROCESS"], key=sizes["_EPROCESS"].get), 16),
                          "confidence": conf_p,
                          "basis": c["basisP"],
                          "members": sorted(p.values(), key=lambda m: (m["offset"], m["name"]))},
            "_ETHREAD": {"size": int(max(sizes["_ETHREAD"], key=sizes["_ETHREAD"].get), 16),
                         "confidence": "medium",
                         "basis": c["basisT"],
                         "members": sorted(t.values(), key=lambda m: (m["offset"], m["name"]))},
        }
        path = os.path.join(outdir, "ntoskrnl-%s-%s.json" % (c["build"], c["arch"]))
        with open(path, "w") as f:
            json.dump(spec, f, indent=1)
        print(path, len(p), "process members,", len(t), "thread members", file=sys.stderr)

if __name__ == "__main__":
    main()
