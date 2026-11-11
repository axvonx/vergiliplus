// The cross-build diff (web/public/assets/diff.js) over real views from lib/panel.mjs.
//   node --test tests/diff.test.mjs
//   UPDATE_GOLDEN=1 node --test tests/diff.test.mjs   re-bless the listing fixture
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Types } from "../web/src/lib/types.mjs";
import { loadDoc } from "../web/src/lib/catalog.mjs";
import { panelHtml } from "../web/src/lib/panel.mjs";
import "../web/public/assets/diff.js";

const V = globalThis.vpDiff;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");
const GOLDEN = path.join(HERE, "golden");
const docs = new Map();
const doc = (file) => {
  if (!docs.has(file)) { const d = loadDoc(path.join(DATA, file)); docs.set(file, [d, new Types(d)]); }
  return docs.get(file);
};
const view = (build, name, mod = "ntoskrnl", arch = "x64") => {
  const [d, T] = doc(`${mod}-${build}-${arch}.json`);
  return panelHtml(T, name, d);
};
const pair = (a, b, name = "_EPROCESS") => V.diff(V.parse(view(a, name)), V.parse(view(b, name)));

test("row keys are unique and name nested members by path", () => {
  const keys = V.parse(view("10.0.18362.1621", "_EPROCESS")).rows.map((r) => r.k).filter((k) => k != null);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("MitigationFlags2Values.CetUserShadowStacks"));
  assert.ok(keys.includes("Pcb") && keys.includes("Vm"));
  assert.ok(!keys.some((k) => k.includes("#")), "no duplicate names in _EPROCESS");
});

test("24H2 → 26H1 _EPROCESS: a spare byte reused, a field dropped, three shifted", () => {
  const D = pair("10.0.26100.32230", "10.0.28000.3231");
  assert.deepEqual(D.count, { add: 4, del: 2, type: 2, grew: 0, shift: 3 });
  assert.deepEqual(D.size, [2112, 2112]);
  assert.equal(D.runs.length, 1);
  const [r] = D.runs;
  assert.deepEqual([r.delta, r.n, r.first, r.last, V.causeText(r.cause)],
    [8, 3, "FreezeWorkLinks", "BamPpmPolicy", "JobCpuPartitionObject added"]);
  // the listing is the spec: review its fixture's diff like code
  const L = V.listing(D, "struct _EPROCESS {");
  const f = path.join(GOLDEN, "diff.x64._EPROCESS.26100.32230-28000.3231.txt");
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(f, L.text + "\n");
  assert.equal(L.text + "\n", fs.readFileSync(f, "utf8"));
});

test("1809 → 1903 _EPROCESS: 236 shifts are two runs, each credited to a nested type growing", () => {
  const D = pair("10.0.17763.737", "10.0.18362.1621");
  assert.equal(D.count.grew, 2);
  assert.equal(D.count.shift, 236);
  assert.deepEqual(D.runs.map((r) => [r.delta, r.n, V.causeText(r.cause)]),
    [[0x8, 90, "Pcb grew"], [0x30, 146, "Vm grew"]]);
});

test("a build against itself has no changes", () => {
  const D = pair("10.0.26100.7824", "10.0.26100.7824");
  assert.deepEqual(D.count, { add: 0, del: 0, type: 0, grew: 0, shift: 0 });
  assert.equal(D.runs.length, 0);
  assert.ok(D.rows.every((x) => x.st === "same" || x.st === "ctx"));
});

test("enums diff by name; a renumbered value is a shift, never a type change", () => {
  const D = pair("10.0.19041.2006", "10.0.26100.7824", "_SYSTEM_INFORMATION_CLASS");
  assert.equal(D.isEnum, true);
  assert.equal(D.count.type, 0);
  assert.ok(D.count.add > 0);
});

test("untyped views (NT 3.51) parse their inline offsets", () => {
  const P = V.parse(view("3.51.1057.1", "_EPROCESS", "ntoskrnl", "x86"));
  const pcb = P.rows.find((r) => r.k === "Pcb");
  assert.equal(pcb.o, 0);
  assert.ok(P.rows.filter((r) => r.k != null).every((r) => Number.isInteger(r.o)));
});

test("history marks where a member first appears", () => {
  const builds = ["10.0.26100.7824", "10.0.26100.32230", "10.0.28000.3231"];
  const views = builds.map((b) => ({ build: b, label: b, title: b, st: "d", view: view(b, "_EPROCESS") }));
  const H = V.history(views, builds[2], false);
  assert.ok(H.shown > 0 && H.shown < H.total);
  const row = H.html.split("<tr>").find((r) => r.startsWith("<th>VirtualTimersPaused</th>"));
  assert.ok(row, "VirtualTimersPaused is listed: it appears in 26H1");
  assert.deepEqual([...row.matchAll(/<td class="(\w*)/g)].map((m) => m[1]), ["", "", "n"]);
});

test("untyped views compare by offset only: 3.50 → 3.51 and 3.51 → 4.0 _EPROCESS report no type changes", () => {
  const x86 = (b) => V.parse(view(b, "_EPROCESS", "ntoskrnl", "x86"));
  const A = x86("3.50.807.1"), B = x86("3.51.1057.1"), C = x86("4.0.1381.1");
  const D1 = V.diff(A, B), D2 = V.diff(B, C);
  assert.equal(D1.count.type, 0);
  assert.equal(D2.count.type, 0);
  const f = D1.rows.find((x) => x.r.k === "ForkWasSuccessful");
  assert.equal(f.st, "shift");
  assert.ok(B.rows.every((r) => r.k == null || !/^\+0x/.test(r.text)), "the inline offset is not part of the text");
  assert.ok(D1.runs.length > 0, "the moves read as shifted runs");
});

// x86 _KPCR's history over the real pack builds (panel.mjs typePages/viewOf)
const kpcrViews = async () => {
  const { typePages, viewOf } = await import("../web/src/lib/panel.mjs");
  const pg = typePages().find((p) => p.arch === "x86" && p.module === "ntoskrnl" && p.name === "_KPCR");
  return pg.builds.map((b, j) => pg.has[j] === "-" ? null
    : { build: b, label: b, title: b, st: pg.has[j], view: viewOf(pg, b).view }).filter(Boolean);
};
const cells = (H, k) => {
  const row = H.html.split("<tr>").find((r) => r.startsWith(`<th>${k}</th>`));
  return row && [...row.matchAll(/<td class="(\w*)/g)].map((m) => m[1]);
};

test("history: a member a partial layout lacks is not recorded there, never 'first appears' after it", async () => {
  const views = await kpcrViews();
  const H = V.history(views, views.at(-1).build, true);
  assert.equal(H.partial, true);
  const builds = views.map((v) => v.build);
  // IrrActive: missing from the 1991 debugger's _KPCR, in the 3.5 headers
  const irr = cells(H, "IrrActive");
  assert.deepEqual(irr.slice(0, 3), ["nr", "nr", "p"]);
  assert.ok(!irr.includes("n"));
  // KdVersionBlock: missing from every partial layout and Windows 2000's records, new in XP SP1
  const kd = cells(H, "KdVersionBlock");
  assert.equal(kd[builds.indexOf("5.0.2195.7045")], "");
  assert.equal(kd[builds.indexOf("5.1.2600.1106")], "n");
  assert.ok(H.html.includes(' pt"'), "partial columns are marked");
  // and without "all", IrrActive is not listed: it neither appears nor vanishes
  assert.equal(cells(V.history(views, views.at(-1).build, false), "IrrActive"), undefined);
});

test("history: a build whose sources define the type twice shows its first definition", async () => {
  const { typePages, viewOf } = await import("../web/src/lib/panel.mjs");
  const pg = typePages().find((p) => p.arch === "mips" && p.module === "ntdll" && p.name === "_PEB");
  const j = pg.builds.indexOf("3.10.404.1");
  const v = viewOf(pg, "3.10.404.1").view;
  assert.ok(V.parse(v).variants > 1);
  const H = V.history([{ build: pg.builds[j], label: "404", title: "404", st: "d", view: v }], pg.builds[j], true);
  assert.ok(H.total > 0, "the column has members");
  assert.ok(!H.html.includes('class="op'), "not drawn as no layout");
});

test("forward refs to a name with several definitions bind the documented one (pdb_to_json bind_forwards)", () => {
  // Bound right, the other definition is unreachable and pruned: two reachable
  // definitions of one name appear only when a forward ref holds the wrong one.
  const anon = (n) => !n || n.startsWith("<") || n.startsWith("__unnamed");
  for (const f of fs.readdirSync(DATA).filter((f) => f.endsWith(".json") && f !== "sources.json")) {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
    if (d.sources) continue;  // records/headers docs are not convert()'s output
    const defs = new Map();
    for (const [k, t] of Object.entries(d.types))
      if (t.fieldlist && !t.forward && !anon(t.name)) { const key = t.kind + "|" + t.name; defs.set(key, (defs.get(key) || 0) + 1); }
    for (const t of Object.values(d.types)) {
      if (!["struct", "union", "enum"].includes(t.kind) || t.fieldlist || !t.forward || anon(t.name)) continue;
      if ((defs.get(t.kind + "|" + t.name) || 0) < 2 || !(t.name in d.named)) continue;
      assert.equal(t.forward, d.named[t.name], `${f}: forward ${t.name} -> ${t.forward}, documented ${d.named[t.name]}`);
    }
  }
});

test("x64 ntoskrnl _KPCR embeds the whole _KPRCB (not its truncated twin) in every build", () => {
  for (const b of ["10.0.19041.2006", "10.0.22621.7079", "10.0.29680.1000"]) {
    const P = V.parse(view(b, "_KPCR")), prcb = P.rows.find((r) => r.k === "Prcb");
    assert.equal(prcb.o + prcb.sz, P.size, `${b}: Prcb ends the struct`);
  }
});

test("a page points at the other module's builds it has no layout for", async () => {
  const { typePages, siblingLayouts } = await import("../web/src/lib/panel.mjs");
  const pg = (m) => typePages().find((p) => p.arch === "x64" && p.module === m && p.name === "_KPCR");
  assert.equal(siblingLayouts(pg("ntdll")), "ntoskrnl:5.2.3790.3959,6.0.6002.18005");
  assert.equal(siblingLayouts(pg("ntoskrnl")), "");
});
