#!/usr/bin/env python3
"""A DDK's C headers -> a vergiliplus doc with *computed* layouts (clang, MSVC 32-bit rules).

Where no type record exists, Microsoft's own declarations still do: each DDK ships the
headers drivers were compiled with (ntddk.h, ntdef.h, ...). clang compiles them as an
MSVC x86 target (natural alignment, MS bitfields, #pragma pack: the same rules the NT
compilers used on MIPS, Alpha and PowerPC too) with the target's architecture macros,
emits CodeView for every type (-fno-eliminate-unused-debug-types), lld-link writes a PDB
and pdb_to_json reads it like any other.

Before compiling, a preprocessed pass drops every top-level function body (inline
assembly, intrinsics: no type lives there) and renames the intrinsics clang has as
builtins, whose 1990s prototypes it would reject. A few C runtime headers the DDKs
expect but don't ship come from hstub/ (one line each; see there).

Validated against recorded layouts (NT 4.0 DDK libraries, x86/MIPS/Alpha/PPC; build
404.1's MIPS binaries): every offset a header gives is exact. A header is the *public*
view, though: private members may be missing (_FILE_NETWORK_OPEN_INFORMATION.EaSize),
and a kernel-private struct may be declared only up to its public prefix (_KPRCB).
So `merge` lets recorded layouts win and only adds what they lack, after checking that
every member the header gives sits where the recorded layout has it.

  headers.py deps INCDIR... --arch A [--top ntddk.h]   headers the compile reads (pinning)
  headers.py INCDIR... --arch A --build B [--top windef.h --only winnt.h] -o out.json
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import pdb_to_json as P  # noqa: E402

STUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hstub")
NOT_X86 = ["-U_M_IX86", "-U__i386__", "-U__i386", "-Ui386", "-U_X86_"]
ARCH = {
    "x86": ["-D_X86_=1", "-Di386=1"],
    "mips": NOT_X86 + ["-D_MIPS_=1", "-DMIPS=1", "-DR4000=1", "-D_M_MRX000=4000"],
    "alpha": NOT_X86 + ["-D_ALPHA_=1", "-DALPHA=1", "-D_M_ALPHA=1"],
    "ppc": NOT_X86 + ["-D_PPC_=1", "-DPPC=1", "-D_M_PPC=1"],
}
BUILTINS = ["__emul", "__emulu", "__ll_lshift", "__ll_rshift", "__ull_rshift",
            "_InterlockedIncrement", "_InterlockedDecrement", "_InterlockedExchange",
            "_InterlockedExchangeAdd", "_InterlockedCompareExchange", "_enable", "_disable",
            "_ReturnAddress"]
# DEVL: Microsoft's own NT builds defined it (July 1992's WINNT.H gives
# _RTL_CRITICAL_SECTION its debug members under it; that build's binaries have them)
CLANG = ["-target", "i386-pc-windows-msvc", "-fms-extensions", "-fms-compatibility",
         "-nostdinc", "-Wno-everything", "-DDEVL=1"]
REFS = ("fieldlist", "forward", "referent", "element", "type", "return")


def tool(name):
    t = shutil.which(name)
    if not t:
        raise RuntimeError("need %s (LLVM) on PATH to compile headers" % name)
    return t


def incs(dirs):
    return [a for d in list(dirs) + [STUB] for a in ("-I", d)]


def deps(dirs, arch, top="ntddk.h"):
    """Paths (relative to their include dir) of the headers compiling `top` reads."""
    with tempfile.TemporaryDirectory() as w:
        open(os.path.join(w, "tu.c"), "w").write("#include <%s>\n" % top)
        r = subprocess.run([tool("clang")] + CLANG + ARCH[arch] + incs(dirs) +
                           ["-M", os.path.join(w, "tu.c")], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stderr[-2000:])
    files = r.stdout.replace("\\\n", " ").split(":", 1)[1].split()
    out = set()
    for f in files:
        for d in dirs:
            if os.path.abspath(f).startswith(os.path.abspath(d) + os.sep):
                out.add(os.path.relpath(f, d))
    return sorted(out)


def strip_bodies(src):
    """Drop top-level function bodies: a '{' at depth 0 right after ')'."""
    out, i, n, depth, last = [], 0, len(src), 0, ""
    while i < n:
        c = src[i]
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1])
            i, last = j + 1, c
            continue
        if c == "{" and depth == 0 and last == ")":
            d, j = 1, i + 1
            while j < n and d:
                d += {"{": 1, "}": -1}.get(src[j], 0)
                j += 1
            out.append(";")
            i, last = j, ";"
            continue
        depth += {"{": 1, "}": -1}.get(c, 0)
        out.append(c)
        if not c.isspace():
            last = c
        i += 1
    return "".join(out)


def statements(src):
    """Top-level declarations of preprocessed C, each with its trailing text."""
    out, i, n, depth, start = [], 0, len(src), 0, 0
    while i < n:
        c = src[i]
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            i = j + 1
            continue
        if c in "{(":
            depth += 1
        elif c in "})":
            depth -= 1
        elif c == ";" and depth == 0:
            j = src.find("\n", i)
            j = n if j < 0 else j + 1
            out.append(src[start:j])
            start = i = j
            continue
        i += 1
    if start < n:
        out.append(src[start:])
    return out


def unmark(pre):
    """Preprocessed text with line markers -> (text without them, {line: header base name})
    (1-based lines of the text returned)."""
    out, where, cur = [], {}, ""
    for ln in pre.split("\n"):
        m = re.match(r'#\s*(?:line\s+)?\d+\s+"([^"]*)"', ln)
        if m:
            cur = os.path.basename(m.group(1)).lower()
            continue
        out.append(ln)
        where[len(out)] = cur
    return "\n".join(out), where


def defined_in(stmts, where, files):
    """Names the declarations from `files` (header base names) define: struct/union/enum
    tags with a body, and typedef names declared alongside a body."""
    names, line = set(), 1
    for st in stmts:
        src = where.get(line + len(st) - len(st.lstrip("\n")), "")
        line += st.count("\n")
        if src not in files or "{" not in st:
            continue
        names.update(re.findall(r"\b(?:struct|union|enum)\s+(\w+)\s*\{", st))
        if re.match(r"\s*typedef\b", st):
            tail = st[st.rfind("}") + 1:]
            names.update(re.findall(r"\b([A-Za-z_]\w*)\s*(?=[,;\[])", tail))
    return names


def convert(dirs, arch, module, build, family="", note="", top="ntddk.h", only=None):
    """Include dirs (searched in order) -> the doc of every type compiling `top` defines
    (`only`: header base names; then only the types those headers define)."""
    with tempfile.TemporaryDirectory() as w:
        tu = os.path.join(w, "tu.c")
        open(tu, "w").write("#include <%s>\n" % top)
        pre = subprocess.run([tool("clang")] + CLANG + ARCH[arch] + incs(dirs) + ["-E", tu],
                             capture_output=True, text=True)
        if pre.returncode:
            raise RuntimeError("preprocessing %s: %s" % (top, pre.stderr[-2000:]))
        src, where = unmark(pre.stdout)
        keep = defined_in(statements(src), where, {f.lower() for f in only}) if only else None
        src = strip_bodies(src)
        for b in BUILTINS:
            src = re.sub(r"\b%s\b" % b, "vp" + b, src)
        stmts = statements(src)
        obj, pdb = os.path.join(w, "tu.obj"), os.path.join(w, "tu.pdb")
        dropped = []
        for _ in range(40):  # a declaration clang rejects is dropped, never a whole compile
            tu = os.path.join(w, "tu_types.c")
            open(tu, "w").write("".join(stmts) + "\nint vp_anchor(void) { return 0; }\n")
            r = subprocess.run([tool("clang")] + CLANG + ["-ferror-limit=0", "-g", "-gcodeview",
                                "-fno-eliminate-unused-debug-types", "-c", tu, "-o", obj],
                               capture_output=True, text=True)
            if not r.returncode:
                break
            lines = {int(m) for m in re.findall(r"tu_types\.c:(\d+):\d+: error", r.stderr)}
            starts, line = [], 1
            for st in stmts:
                starts.append(line)
                line += st.count("\n")
            bad = {i for i, st in enumerate(stmts) for ln in lines
                   if starts[i] <= ln < starts[i] + max(1, st.count("\n"))}
            if not bad:
                raise RuntimeError("compiling %s for %s: %s" % (top, arch, r.stderr[-2500:]))
            dropped += [stmts[i] for i in sorted(bad)]
            stmts = [st for i, st in enumerate(stmts) if i not in bad]
        else:
            raise RuntimeError("compiling %s for %s: too many rejected declarations" % (top, arch))
        if dropped:
            lost = sorted({m for d in dropped
                           for m in re.findall(r"\b(?:struct|union|enum)\s+(\w+)\s*\{", d)})
            print("  headers %s: %d declarations clang rejects dropped, e.g. %s%s"
                  % (arch, len(dropped), " ".join(dropped[0].split())[:80],
                     "; LOST type definitions: " + ", ".join(lost) if lost else ""), file=sys.stderr)
        subprocess.run([tool("lld-link"), "/dll", "/noentry", "/nodefaultlib", "/machine:x86",
                        "/debug", "/export:vp_anchor", "/out:" + os.path.join(w, "tu.dll"),
                        "/pdb:" + pdb, obj], check=True, capture_output=True)
        doc = P.convert(pdb, module, arch, build, family, None)
    # clang names an anonymous member aggregate "_PARENT::<unnamed-tag>"; MSVC (and the
    # renderer) call every one "<unnamed-tag>"
    for t in doc["types"].values():
        if "<unnamed-tag>" in (t.get("name") or ""):
            t["name"] = "<unnamed-tag>"
    doc["named"] = {n: k for n, k in doc["named"].items() if "<unnamed-tag>" not in n
                    and (keep is None or n in keep)}
    doc["types"] = P.reachable(doc["types"], doc["named"].values())
    doc["opaque"] = {n: k for n, k in doc["opaque"].items() if n not in doc["named"]}
    doc["provenance"] = {"kind": "computed", "note": note}
    doc["pdb"] = None
    return doc


def flat(doc, i, base=0, pre="", depth=0):
    """[(member path, offset[, bitpos, bits])] of a struct, nested aggregates expanded
    (resolved by name where the node is a forward reference)."""
    t, out = doc["types"], []
    n = t[i]
    if not n.get("fieldlist") and n.get("name") in doc["named"]:
        n = t[doc["named"][n["name"]]]
    for m in t.get(n.get("fieldlist") or "", {}).get("members", []):
        off, name = base + m["offset"], pre + (m["name"] or "")
        if m["type"] is None:  # untyped (names + offsets from a debugger extension)
            out.append((name, off))
            continue
        mt = t[m["type"]]
        if mt["kind"] == "bitfield":
            out.append((name, off, mt["pos"], mt["bits"]))
            continue
        out.append((name, off))
        if mt["kind"] in ("struct", "union") and depth < 12:
            out += flat(doc, m["type"], off, name + ".", depth + 1)
    return out


def check(rec, hdr):
    """Shared struct names whose header members don't all sit where the recorded layout
    has them: [(name, first header member not found)]. A missing member is fine (the
    header's public view); one at another offset is not."""
    bad = []
    for n in sorted(set(rec["named"]) & set(hdr["named"])):
        if hdr["types"][hdr["named"][n]]["kind"] == "enum":
            continue
        have = set(flat(rec, rec["named"][n]))
        offs = {x[1:] for x in have}
        for x in flat(hdr, hdr["named"][n]):
            if x not in have and x[1:] not in offs:
                bad.append((n, x))
                break
    return bad


def merge(rec, hdr, note):
    """rec + the named types (and what they reach) only hdr defines; names rec has keep
    rec's node. Those types' provenance is `note`. Returns the added names."""
    new = sorted(set(hdr["named"]) - set(rec["named"]))
    reach = P.reachable(hdr["types"], [hdr["named"][n] for n in new])
    used = [int(k, 16) for k in rec["types"]]
    nxt = max(used, default=0x1000) + 1
    idmap = {}
    for k in sorted(reach, key=lambda k: int(k, 16)):
        t = reach[k]
        if t.get("kind") in ("struct", "union", "enum") and t.get("name") in rec["named"] \
                and t["name"] not in new:
            idmap[k] = rec["named"][t["name"]]
        else:
            idmap[k], nxt = P.hexi(nxt), nxt + 1
    remap = lambda v: idmap.get(v, v) if isinstance(v, str) else v
    for k, t in reach.items():
        if idmap[k] in rec["types"]:
            continue
        t = dict(t)
        for f in REFS:
            if f in t:
                t[f] = remap(t[f])
        if isinstance(t.get("args"), list):
            t["args"] = [remap(a) for a in t["args"]]
        elif "args" in t:
            t["args"] = remap(t["args"])
        if "members" in t:
            t["members"] = [dict(m, type=remap(m["type"])) for m in t["members"]]
        rec["types"][idmap[k]] = t
    for n in new:
        rec["named"][n] = idmap[hdr["named"][n]]
    rec["named"] = dict(sorted(rec["named"].items()))
    rec["opaque"] = dict(sorted({**{n: k for n, k in hdr["opaque"].items() if n not in rec["named"]},
                                 **{n: k for n, k in rec.get("opaque", {}).items()
                                    if n not in rec["named"]}}.items()))
    pt = rec.setdefault("provenanceTypes", {})
    for n in new:
        pt[n] = {"kind": "computed", "note": note}
    rec["provenanceTypes"] = dict(sorted(pt.items()))
    return new


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd_or_dir")
    ap.add_argument("dirs", nargs="*")
    ap.add_argument("--arch", required=True)
    ap.add_argument("--build")
    ap.add_argument("--top", default="ntddk.h")
    ap.add_argument("--only", action="append")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()
    if a.cmd_or_dir == "deps":
        print("\n".join(deps(a.dirs, a.arch, a.top)))
        return
    doc = convert([a.cmd_or_dir] + a.dirs, a.arch, "ntoskrnl", a.build, top=a.top, only=a.only)
    if a.out:
        P.write(doc, a.out)
    else:
        json.dump(doc, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
