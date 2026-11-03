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
  doc.opaque ||= {};  // names declared/mentioned but not defined in this PDB: {name: kind}
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
  for (const d of docs) {
    byKey.set(key(d.arch, d.build, d.module), d);
    (builds.get(key(d.arch, d.module)) || builds.set(key(d.arch, d.module), []).get(key(d.arch, d.module))).push(d.build);
    (modules.get(key(d.arch, d.build)) || modules.set(key(d.arch, d.build), []).get(key(d.arch, d.build))).push(d.module);
  }
  for (const v of builds.values()) v.sort(cmpBuild);
  _cat = {
    docs,
    get: (a, b, m) => byKey.get(key(a, b, m)),
    builds: (a, m) => builds.get(key(a, m)) || [],
    modules: (a, b) => (modules.get(key(a, b)) || []).slice().sort(),
    // current ones first, then the historical ones
    archs: () => [...new Set(docs.map((d) => d.arch))].sort((a, b) => archRank(a) - archRank(b) || (a < b ? -1 : 1)),
    // what a build is called on screen: its build string, or doc.buildLabel where that is
    // only a sort key ("no build number" pre-releases)
    label: (a, b) => docs.find((d) => d.arch === a && d.build === b)?.buildLabel || b,
    // one entry per arch × build, newest first: {arch, build, family, label, tags} (tags:
    // the union over the build's modules, see docTags)
    versions: () => {
      const out = new Map();
      for (const d of docs.slice().sort((x, y) => cmpBuild(y.build, x.build))) {
        const k = d.arch + "/" + d.build, v = out.get(k);
        if (v) v.tags = [...new Set([...v.tags, ...docTags(d)])].sort((a, b) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b));
        else out.set(k, { arch: d.arch, build: d.build, family: d.family, label: d.buildLabel || d.build, tags: docTags(d) });
      }
      return [...out.values()];
    },
  };
  return _cat;
}

const _t = new WeakMap(), _u = new WeakMap(), _s = new WeakMap(), _l = new WeakMap();
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

// every type with a page in a doc, documented and opaque: [{n, k, s, o[, a]}] by name
// (a: named only, by ASSERT text: doc.attested).
// Slugs are unique per doc (documented names claim theirs first).
export function typeList(doc) {
  if (!_l.has(doc)) {
    const T = typesFor(doc), seen = new Set(slugNames(doc).map(slug));
    const out = slugNames(doc).map((n) => ({ n, k: T.get(doc.named[n]).kind, s: slug(n), o: false }));
    for (const [n, k] of Object.entries(doc.opaque)) {
      const s = slug(n);
      if (!seen.has(s)) { seen.add(s); out.push(doc.attested?.[n] ? { n, k, s, o: true, a: true } : { n, k, s, o: true }); }
    }
    _l.set(doc, out.sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0)));
  }
  return _l.get(doc);
}

const ARCHS = ["x64", "x86", "arm64", "ia64", "alpha", "mips", "ppc"];
const archRank = (a) => (ARCHS.includes(a) ? ARCHS.indexOf(a) : ARCHS.length);

export const ctxPath = (a, b, m) => `/v/${a}/${b}/${m}`;

// a build's row with its display label and source tags appended where they apply:
// [...row] | [...row, label] | [...row, label, tags] (tags as given: names, or
// [tag, tooltip] pairs)
export const vrow = (x, row) =>
  x.tags?.length ? [...row, x.label, x.tags] : x.label !== x.build ? [...row, x.label] : row;

// Where a build's layouts come from, as tags (doc.sources, written by tools/build.py);
// none for a public PDB. "partial" marks a build with a hole the tags don't say
// (doc.incomplete: one line naming the gap).
export const TAGS = {
  records: "Microsoft's own type records (CodeView) in a library or binary",
  debugger: "a 1991 kernel debugger's own types, re-laid out for 32-bit",
  headers: "computed by compiling the DDK or SDK headers",
  offsets: "member names and offsets only, as a debugger extension prints them",
  names: "names only, from a checked build's ASSERT text",
  partial: "",
};
const TAG_ORDER = Object.keys(TAGS);
export const docTags = (doc) => [...new Set((doc.sources || []).map((s) => s.tag)),
  ...(doc.incomplete ? ["partial"] : [])].sort((a, b) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b));
// a tag's tooltip in one doc: what it means, then the sources it stands for
export const tagTitle = (doc, tag) => tag === "partial" ? doc.incomplete
  : [TAGS[tag], ...(doc.sources || []).filter((s) => s.tag === tag).map((s) => "· " + s.cite)].join("\n");

// a family name split for display: product = the group heading, release = what a row
// shows. "Windows 10 1703" -> {Windows 10, 1703}, "Windows Server 2016" -> {Windows
// Server, 2016}; a bare product ("Windows 8") is its own release ("8").
export function product(family) {
  const m = /^Windows (NT|Server|Vista|XP|\d+(?:\.\d+)?)\b[ ,]*(.*)$/.exec(family || "");
  if (!m) return { product: family || "", release: family || "" };
  return { product: "Windows " + m[1], release: m[2] || m[1] };
}

// release channel from the family name, for colour-coding versions
export const channel = (family) =>
  /server/i.test(family) ? "server" : /canary|insider|dev|beta|preview|pre-release|\bRC\d/i.test(family) ? "insider" : "client";

// The search palette's rows (/search-index.json; /member-index.json refers to t by
// position): v = [[arch, build, family, channel[, label, tags]]] newest first (label
// only where it isn't the build string, tags only where a build has them), m = [module],
// t = [[name, kind, slug, module#, [v# defining it], [v# where opaque]]] by name.
let _rows = null;
export function searchRows() {
  if (_rows) return _rows;
  const cat = catalog();
  const v = cat.versions();
  const vi = new Map(v.map((x, i) => [x.arch + "/" + x.build, i]));
  const m = [...new Set(cat.docs.map((d) => d.module))].sort();
  const t = new Map();
  for (const d of cat.docs) {
    const mi = m.indexOf(d.module), i = vi.get(d.arch + "/" + d.build);
    for (const it of typeList(d)) {
      const k = it.n + "|" + mi;
      const e = t.get(k) || t.set(k, [it.n, it.k, it.s, mi, [], []]).get(k);
      if (!it.o) e[1] = it.k;  // a definition's kind wins over a forward declaration's
      e[it.o ? 5 : 4].push(i);
    }
  }
  for (const e of t.values()) { e[4].sort((a, b) => a - b); e[5].sort((a, b) => a - b); }
  return (_rows = {
    v: v.map((x) => vrow(x, [x.arch, x.build, x.family, channel(x.family)])),
    m,
    t: [...t.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[3] - b[3])),
  });
}
