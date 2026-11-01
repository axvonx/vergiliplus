// The data catalog: every data/*.json loaded once per build (never re-read per page),
// cross-build indexes, memoized per-doc views, and URL helpers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Types, ANON, slug } from "./types.mjs";
import { usedIn } from "./layout.mjs";

export function buildKey(b) {
  const p = (b.split(/[.\-]/).concat(["0", "0", "0", "0"])).slice(0, 4);
  return p.map(x => parseInt(x, 10) || 0);
}
export function cmpBuild(a, b) {
  const ka = buildKey(a), kb = buildKey(b);
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

export function loadDoc(p) {
  const doc = JSON.parse(fs.readFileSync(p, "utf8"));
  // "<unnamed-tag>" is MSVC's name for every anonymous aggregate: not a real type
  for (const n of Object.keys(doc.named)) if (ANON.test(n)) delete doc.named[n];
  return doc;
}

// Find the repo root (the dir holding data/sources.json) by walking up from the cwd;
// robust when this module is bundled into a dist/ chunk.
function findRoot() {
  let d = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, "data", "sources.json"))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}
export const DATA_DIR = path.join(findRoot(), "data");

const key = (...p) => p.join("|");
let _cat = null;

// Every data/*.json loaded once per build, plus the cross-build indexes.
export function catalog() {
  if (_cat) return _cat;
  const docs = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith(".json") && f !== "sources.json")
    .map(f => loadDoc(path.join(DATA_DIR, f)));
  const byKey = new Map();
  const builds = new Map();   // arch|module -> [build asc]
  const modules = new Map();  // arch|build  -> [module]
  const wizard = new Map();   // arch|module|name -> [build asc]
  for (const d of docs) {
    byKey.set(key(d.arch, d.build, d.module), d);
    (builds.get(key(d.arch, d.module)) || builds.set(key(d.arch, d.module), []).get(key(d.arch, d.module))).push(d.build);
    (modules.get(key(d.arch, d.build)) || modules.set(key(d.arch, d.build), []).get(key(d.arch, d.build))).push(d.module);
    for (const n of Object.keys(d.named)) {
      const k = key(d.arch, d.module, n);
      (wizard.get(k) || wizard.set(k, []).get(k)).push(d.build);
    }
  }
  for (const v of builds.values()) v.sort(cmpBuild);
  for (const v of wizard.values()) v.sort(cmpBuild);
  _cat = {
    docs,
    get: (a, b, m) => byKey.get(key(a, b, m)),
    builds: (a, m) => builds.get(key(a, m)) || [],
    modules: (a, b) => (modules.get(key(a, b)) || []).slice().sort(),
    archs: () => [...new Set(docs.map((d) => d.arch))].sort(),
    // one entry per arch × build, newest first: {arch, build, family}
    versions: () => [...new Map(docs.slice().sort((x, y) => cmpBuild(y.build, x.build))
      .map((d) => [d.arch + "/" + d.build, { arch: d.arch, build: d.build, family: d.family }])).values()],
    typeBuilds: (a, m, n) => wizard.get(key(a, m, n)) || [],
  };
  return _cat;
}

const _t = new WeakMap(), _u = new WeakMap(), _s = new WeakMap();
export function typesFor(doc) {
  if (!_t.has(doc)) _t.set(doc, new Types(doc));
  return _t.get(doc);
}
export function usedInFor(doc) {
  if (!_u.has(doc)) _u.set(doc, usedIn(typesFor(doc)));
  return _u.get(doc);
}
// unique-by-slug type names of a doc (avoid output-path collisions)
export function slugNames(doc) {
  if (!_s.has(doc)) {
    const seen = new Set(), out = [];
    for (const n of Object.keys(doc.named).sort()) {
      const p = slug(n);
      if (!seen.has(p)) { seen.add(p); out.push(n); }
    }
    _s.set(doc, out);
  }
  return _s.get(doc);
}

export const ctxPath = (a, b, m) => `/v/${a}/${b}/${m}`;

// release channel from the family name, for colour-coding versions
export const channel = (family) =>
  /server/i.test(family) ? "server" : /canary|insider|dev|beta|preview/i.test(family) ? "insider" : "client";
