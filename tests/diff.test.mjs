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
