// Golden tests for the type renderer (web/src/lib/render.mjs).
//   node --test tests/                 (or: cd web && pnpm test)
//   UPDATE_GOLDEN=1 node --test tests/ re-bless after an intended rendering change
// Fixtures are paholeText() output for landmark types; review their diff like code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Renderer, loadDoc } from "../web/src/lib/render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");
const GOLDEN = path.join(HERE, "golden");
const UPDATE = !!process.env.UPDATE_GOLDEN;

const docs = new Map();
const renderer = (file) => {
  if (!docs.has(file)) docs.set(file, new Renderer(loadDoc(path.join(DATA, file))));
  return docs.get(file);
};

const NTDLL = "ntdll-10.0.26100.7824-x64.json";
const NTOS = "ntoskrnl-10.0.26100.7824-x64.json";
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
];

for (const [file, name] of CASES) {
  test(`golden ${file.split("-x64")[0]} ${name}`, () => {
    const got = renderer(file).paholeText(name) + "\n";
    const fx = path.join(GOLDEN, `${file.split("-")[0]}.${name}.txt`);
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
  const L = r.paholeLayout("_MI_HYPER_SPACE");
  assert.ok(L.summary.size > 250e6);
  assert.ok(L.rows.length < 20, `rows: ${L.rows.length}`);
  assert.ok(performance.now() - t0 < 500);
});

// Every documented struct/union in a doc lays out without throwing, with every row
// offset inside the type and member counts preserved.
test("all ntoskrnl 24H2 layouts are well-formed", () => {
  const r = renderer(NTOS);
  for (const name of Object.keys(r.named)) {
    const L = r.paholeLayout(name);
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

// ---- synthetic docs: arch-aware pointer size (C3) and grouping edge cases ----
const T = (types, named, arch = "x64") => new Renderer({ arch, named, types });
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
  assert.equal(x86.paholeLayout("S").summary.holes, 0);
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
  assert.equal(T(types, { S: "0x1000" }).paholeText("S", false), [
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
