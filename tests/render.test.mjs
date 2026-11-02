// Golden tests for the type renderer (web/src/lib/{types,layout}.mjs).
//   node --test tests/render.test.mjs                 (or: cd web && pnpm test)
//   UPDATE_GOLDEN=1 node --test tests/render.test.mjs re-bless after an intended rendering change
// Fixtures are layoutText() output for landmark types; review their diff like code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Types } from "../web/src/lib/types.mjs";
import { structLayout, layoutText, usedIn } from "../web/src/lib/layout.mjs";
import { loadDoc } from "../web/src/lib/catalog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");
const GOLDEN = path.join(HERE, "golden");
const UPDATE = !!process.env.UPDATE_GOLDEN;

const docs = new Map();
const renderer = (file) => {
  if (!docs.has(file)) docs.set(file, new Types(loadDoc(path.join(DATA, file))));
  return docs.get(file);
};

const NTDLL = "ntdll-10.0.26100.7824-x64.json";
const NTOS = "ntoskrnl-10.0.26100.7824-x64.json";
const NT40 = "ntoskrnl-4.0.1381.1-x86.json";
const OCT91 = "ntoskrnl-0.1991.10.0-x86.json";
const NT351 = "ntoskrnl-3.51.1057.1-x86.json";
const JUL92 = "ntdll-0.1992.7.0-mips.json";
const NT31 = "ntoskrnl-3.10.511.1-x86.json";
// fixture file: <module>.<type>.txt for the 24H2 docs, <doc>.<type>.txt for any other
const fixture = (file, name) =>
  `${[NTDLL, NTOS].includes(file) ? file.split("-")[0] : file.replace(/\.json$/, "")}.${name}.txt`;
const CASES = [
  [NTDLL, "_TP_POOL"],                 // full in ntdll, opaque in ntoskrnl
  [NTDLL, "_PEB"],                     // anonymous unions of bitfield structs
  [NTDLL, "_TEB"],
  [NTOS, "_KTHREAD"],                  // nested anonymous unions/structs
  [NTOS, "_EPROCESS"],
  [NTOS, "_LIST_ENTRY"],
  [NTOS, "_UNICODE_STRING"],
  [NTOS, "_SYSTEM_INFORMATION_CLASS"], // large enum (254 values)
  [NTOS, "_MMPTE_HARDWARE"],           // bitfield-heavy, 64-bit storage unit
  [NTOS, "_LARGE_INTEGER"],            // top-level union + inlined <unnamed-tag> member
  [NTOS, "_CACHE_MANAGER_CALLBACKS"],  // function-pointer signatures
  [NTOS, "_DISPATCHER_HEADER"],        // unions nested three deep
  // pre-PDB: CodeView 4 records of NT 4.0's DDK LIBCNTPR.LIB (tools/legacy/cv4.py),
  // offsets cross-checked against KDEXTX86.DLL; ends with its provenance line
  [NT40, "_EPROCESS"],
  [NT40, "_KTHREAD"],
  // computed: October 1991 I386KD.EXE CodeView 3 (tools/legacy/cv3.py), relaid out
  // naturally; IRR at 0x28 (host 0x25) is the NT 3.1 offset
  [OCT91, "_KPCR"],
  // incomplete: NT 3.51 names+offsets from KDEXTX86.DLL, no types ("untyped")
  [NT351, "_EPROCESS"],
  // recorded, not computed: MIPS USERSRV.DLL's inline CodeView 4, July 1992
  [JUL92, "_PEB"],
  // inferred (reverse-engineered) from NT 3.1's I386KD !process / !thread code:
  // gaps are "not recovered", the tag line is /* inferred: ... */
  [NT31, "_EPROCESS"],
  [NT31, "_ETHREAD"],
];

for (const [file, name] of CASES) {
  test(`golden ${file.replace(/-x64\.json$|\.json$/, "")} ${name}`, () => {
    const got = layoutText(renderer(file), name) + "\n";
    const fx = path.join(GOLDEN, fixture(file, name));
    if (UPDATE || !fs.existsSync(fx)) {
      fs.writeFileSync(fx, got);
      if (!UPDATE) assert.fail(`wrote missing fixture ${path.basename(fx)}; review and re-run`);
      return;
    }
    assert.equal(got, fs.readFileSync(fx, "utf8"));
  });
}

// _MI_HYPER_SPACE is 276 MB: anything scaling with struct *size* instead of member
// count blows the heap. Rows must stay O(members) and render fast.
test("perf canary _MI_HYPER_SPACE", () => {
  const r = renderer("ntoskrnl-10.0.17763.737-x64.json");
  const t0 = performance.now();
  const L = structLayout(r, "_MI_HYPER_SPACE");
  assert.ok(L.summary.size > 250e6);
  assert.ok(L.rows.length < 20, `rows: ${L.rows.length}`);
  assert.ok(performance.now() - t0 < 500);
});

// Every documented struct/union in a doc lays out without throwing, with every row
// offset inside the type and member counts preserved: 24H2's kernel, and every doc
// whose layouts don't come from a public PDB (tools/legacy/).
const legacy = fs.readdirSync(DATA).filter((f) => /^(ntoskrnl|ntdll)-.*\.json$/.test(f) &&
  JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")).provenance);
for (const file of [NTOS, ...legacy]) test(`all ${file} layouts are well-formed`, () => {
  const r = renderer(file);
  for (const name of Object.keys(r.named)) {
    const L = structLayout(r, name);
    if (!L) continue;
    const leaves = L.rows.filter((x) => x.field != null && !x.close).length;
    const inlined = L.rows.filter((x) => x.close && x.field).length;
    assert.ok(leaves + inlined >= L.summary.members, `${name}: lost members`);
    let depth = 0;
    for (const row of L.rows) {
      if (row.open) depth++;
      if (row.close) depth--;
      assert.ok(depth >= 0, `${name}: unbalanced`);
    }
    assert.equal(depth, 0, `${name}: unbalanced`);
  }
});

// "Used in" must credit the enclosing type for references made from inside members
// of anonymous "<unnamed-tag>" type (e.g. union { ...; struct _ERESOURCE* r; } u;)
test("usedIn sees through anonymous member types", () => {
  const used = usedIn(renderer(NTOS))["_ERESOURCE"];
  for (const t of ["_TOKEN", "_HEAP_LOCK", "_FS_FILTER_PARAMETERS"]) assert.ok(used.includes(t), t);
});

// ---- synthetic docs: arch-aware pointer size (C3) and grouping edge cases ----
const T = (types, named, arch = "x64") => new Types({ arch, named, types });
const fl = (members) => ({ kind: "fieldlist", members, enums: [] });

test("pointer size follows the doc's arch", () => {
  const types = {
    "0x1000": { kind: "struct", name: "S", size: 0, fieldlist: "0x1001", forward: null },
    "0x1001": fl([{ name: "p", type: "0x1002", offset: 0 }, { name: "q", type: "0x1002", offset: 4 }]),
    "0x1002": { kind: "pointer", referent: "0x3" },
    "0x3": { kind: "base", name: "void" },
  };
  const x86 = T(types, { S: "0x1000" }, "x86");
  assert.equal(x86.sizeof("0x1002"), 4);
  assert.equal(structLayout(x86, "S").summary.holes, 0);
  assert.equal(T(types, { S: "0x1000" }, "x64").sizeof("0x1002"), 8);
});

test("union of a word and a bitfield struct", () => {
  const types = {
    "0x1000": { kind: "struct", name: "S", size: 4, fieldlist: "0x1001", forward: null },
    "0x1001": fl([
      { name: "All", type: "0x22", offset: 0 },
      { name: "A", type: "0x1002", offset: 0 },
      { name: "B", type: "0x1003", offset: 0 },
    ]),
    "0x1002": { kind: "bitfield", type: "0x22", bits: 1, pos: 0 },
    "0x1003": { kind: "bitfield", type: "0x22", bits: 31, pos: 1 },
    "0x22": { kind: "base", name: "unsigned long" },
  };
  assert.equal(layoutText(T(types, { S: "0x1000" }), "S", false), [
    "struct S {",
    "    union {",
    "        unsigned long All;",
    "        struct {",
    "            unsigned long A : 1;",
    "            unsigned long B : 31;",
    "        };",
    "    };",
    "};",
  ].join("\n"));
});

// a type the sources define in more than one way renders every definition, the first
// shown and the rest hidden, picked by a select; each names its source in its last line
test("variants: build 404's two _PEB definitions", async () => {
  const { panelHtml } = await import("../web/src/lib/panel.mjs");
  const doc = loadDoc(path.join(DATA, "ntdll-3.10.404.1-mips.json"));
  const html = panelHtml(new Types(doc), "_PEB", doc);
  assert.equal((html.match(/data-var="/g) || []).length, 2);
  assert.match(html, /data-var="1" hidden/);
  assert.match(html, /MIPS\/CDPLAYER\.EXE \(112 bytes\)/);
  assert.match(html, /MIPS\/DISKPERF\.EXE \(100 bytes\)/);
  assert.match(html, /this definition: MIPS\/DISKPERF\.EXE/);
});

// every family in data/ splits into a product heading and a release without "Windows "
test("product(): every family splits", async () => {
  const { product } = await import("../web/src/lib/catalog.mjs");
  const fams = new Set();
  for (const f of fs.readdirSync(DATA).filter((f) => f.endsWith(".json"))) {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
    if (d && d.family) fams.add(d.family);
  }
  assert.ok(fams.size > 20);
  for (const fam of fams) {
    const p = product(fam);
    assert.match(p.product, /^Windows (NT|Server|Vista|XP|\d)/, fam);
    assert.ok(p.release && !/^Windows /.test(p.release), fam);
  }
  assert.deepEqual(product("Windows 10 1703"), { product: "Windows 10", release: "1703" });
  assert.deepEqual(product("Windows NT pre-release, April 1991"), { product: "Windows NT", release: "pre-release, April 1991" });
  assert.deepEqual(product("Windows 8"), { product: "Windows 8", release: "8" });
});
