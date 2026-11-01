// Shared type -> C-declaration renderer for the three SSG spikes (port of site/gen.py's
// Renderer). Framework-agnostic ESM: loads a vergiliplus data JSON and produces the
// dracula-coloured, str-link-cross-linked code HTML plus the named-type listing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PTR = 8;
const BASE_SIZES = {
  "char": 1, "signed char": 1, "unsigned char": 1, "bool": 1,
  "short": 2, "unsigned short": 2, "wchar_t": 2, "__wchar_t": 2,
  "int": 4, "unsigned int": 4, "long": 4, "unsigned long": 4, "float": 4,
  "__int64": 8, "unsigned __int64": 8, "double": 8, "long long": 8,
};
const KW = new Set(["struct", "union", "enum", "const", "volatile", "void", "char",
  "bool", "short", "int", "long", "float", "double", "signed", "unsigned",
  "__int64", "wchar_t", "__wchar_t"]);

export const esc = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export const slug = (s) => s.replace(/[^A-Za-z0-9_.-]/g, "_");
const hk = (s) => `<span class="hljs-keyword">${s}</span>`;
const hc = (s) => `<span class="hljs-comment">${s}</span>`;
const hn = (s) => `<span class="hljs-number">${s}</span>`;
const kwOrPlain = (n) => KW.has(n) ? hk(n) : esc(n);

export function buildKey(b) {
  const p = (b.split(/[.\-]/).concat(["0", "0", "0", "0"])).slice(0, 4);
  return p.map(x => parseInt(x, 10) || 0);
}
export function cmpBuild(a, b) {
  const ka = buildKey(a), kb = buildKey(b);
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

export class Renderer {
  constructor(doc) { this.t = doc.types; this.named = doc.named; }
  get(idx) { return this.t[idx] || { kind: "other" }; }
  derefFwd(idx) {
    const n = this.get(idx);
    if (["struct", "union", "enum"].includes(n.kind) && n.forward) return [n.forward, this.get(n.forward)];
    return [idx, n];
  }
  sizeof(idx) {
    const n = this.get(idx);
    switch (n.kind) {
      case "pointer": return PTR;
      case "base": return BASE_SIZES[n.name] ?? (String(n.name).endsWith("*") ? PTR : 0);
      case "modifier": return this.sizeof(n.referent);
      case "array": return n.bytes || 0;
      case "struct": case "union": case "enum": {
        const [, d] = this.derefFwd(idx);
        return d.size || (n.kind === "enum" ? 4 : 0);
      }
      default: return 0;
    }
  }
  refName(idx) {
    const n = this.get(idx);
    if (n.kind === "pointer" || n.kind === "modifier") return this.refName(n.referent);
    if (n.kind === "array") return this.refName(n.element);
    if (n.kind === "bitfield") return this.refName(n.type);
    if (["struct", "union", "enum"].includes(n.kind)) {
      const [, d] = this.derefFwd(idx);
      return d.name || n.name || null;
    }
    return null;
  }
  link(name) {
    const s = esc(name);
    if (name in this.named) return `<a class="str-link" href="${esc(slug(name))}.html">${s}</a>`;
    return `<span class="str-link">${s}</span>`;
  }
  renderType(idx) {
    const n = this.get(idx);
    switch (n.kind) {
      case "base": return [kwOrPlain(n.name || "void"), ""];
      case "modifier": {
        const [pre, suf] = this.renderType(n.referent);
        let mods = (n.volatile ? "volatile " : "") + (n.const ? "const " : "");
        mods = mods.trim().split(/\s+/).filter(Boolean).map(w => hk(w) + " ").join("");
        return [mods + pre, suf];
      }
      case "pointer": {
        const ref = this.get(n.referent);
        if (ref.kind === "proc") return [this.renderType(ref.return)[0] + " (*", ")()"];
        const [pre, suf] = this.renderType(n.referent);
        return [pre + "*", suf];
      }
      case "array": {
        const [pre, suf] = this.renderType(n.element);
        const esz = this.sizeof(n.element) || 1;
        return [pre, `[${hn(String(Math.floor((n.bytes || 0) / esz)))}]${suf}`];
      }
      case "struct": case "union": case "enum": {
        const [didx, d] = this.derefFwd(idx);
        const kind = (d.kind ? d : n).kind;
        const name = d.name || n.name;
        if (name) return [`${hk(kind)} ${this.link(name)}`, ""];
        return [hk(kind) + this.aggBody(didx, 1), ""];
      }
      case "bitfield": return this.renderType(n.type);
      case "proc": return [hk("void"), "()"];
      default: return ["void", ""];
    }
  }
  memberDecl(m, depth) {
    const n = this.get(m.type);
    const name = esc(m.name);
    let decl;
    if (n.kind === "bitfield") {
      const [pre, suf] = this.renderType(n.type);
      decl = `${pre} ${name}${suf} : ${hn(String(n.bits || 0))}`;
    } else {
      const [pre, suf] = this.renderType(m.type);
      decl = `${pre} ${name}${suf}`;
    }
    return [decl, decl.replace(/<[^>]+>/g, "").length];
  }
  aggBody(idx, depth) {
    const n = this.get(idx), fl = this.get(n.fieldlist);
    const ind = "    ".repeat(depth), inner = "    ".repeat(depth + 1);
    if (n.kind === "enum") {
      const vals = fl.enums || [];
      let o = `\n${ind}{`;
      vals.forEach((e, i) => { o += `\n${inner}${esc(e.name)} = ${hn(String(e.value))}${i < vals.length - 1 ? "," : ""}`; });
      return o + `\n${ind}}`;
    }
    let o = `\n${ind}{`;
    for (const m of fl.members || []) {
      const [decl, vis] = this.memberDecl(m, depth + 1);
      const v = inner.length + vis + 1;
      const pad = v <= 75 ? " ".repeat(76 - v) : " ";
      o += `\n${inner}${decl};${pad}${hc("//0x" + m.offset.toString(16))}`;
    }
    return o + `\n${ind}}`;
  }
  toplevel(name) {
    const idx = this.named[name], n = this.get(idx);
    const size = n.size || this.sizeof(idx);
    return `${hc("//0x" + size.toString(16) + " bytes (sizeof)")}\n${hk(n.kind)} ${esc(name)}` +
      this.aggBody(idx, 0) + ";";
  }
  // raw C declaration text (no HTML) — for Expressive Code / Shiki
  plainToplevel(name) {
    return this.toplevel(name).replace(/<[^>]+>/g, "");
  }

  // split type expression around the field name: decl = `${pre} name${suf}`
  typeParts(idx) {
    const [pre, suf] = this.renderType(idx);
    return { pre: pre.trim(), suf };
  }

  memberKind(idx) {
    const n = this.get(idx);
    if (n.kind === "modifier") return this.memberKind(n.referent);
    if (n.kind === "bitfield") return "bitfield";
    if (n.kind === "base") return String(n.name).endsWith("*") ? "pointer" : "base";
    return n.kind; // pointer | array | struct | union | enum | proc
  }

  // pahole-style layout: offset/size per member, explicit holes, cacheline markers, footer
  paholeLayout(name) {
    const idx = this.named[name], n = this.get(idx);
    if (!["struct", "union"].includes(n.kind)) return null;
    const fl = this.get(n.fieldlist);
    const total = n.size || this.sizeof(idx);
    const isUnion = n.kind === "union";
    const rows = [];
    let expected = 0, sumMembers = 0, holes = 0, sumHoles = 0, lastLine = 0;
    for (const m of fl.members || []) {
      const node = this.get(m.type);
      const bf = node.kind === "bitfield";
      const size = bf ? this.sizeof(node.type) : this.sizeof(m.type);
      if (!isUnion && m.offset > expected) {
        const h = m.offset - expected;
        rows.push({ hole: h });
        holes++; sumHoles += h;
      }
      // pahole style: one marker before the first member that starts in a new
      // cacheline (O(members), even for 276 MB structs like _MI_HYPER_SPACE)
      const line = Math.floor(m.offset / 64);
      if (!isUnion && total > 64 && line > lastLine) {
        rows.push({ cacheline: line, bytes: line * 64 });
        lastLine = line;
      }
      const tp = this.typeParts(bf ? node.type : m.type);
      rows.push({
        typePre: tp.pre, typeSuf: tp.suf, fkind: this.memberKind(m.type),
        field: m.name, offset: m.offset, size, bits: bf ? node.bits : null,
        ref: this.refName(m.type),
        reflink: (this.refName(m.type) in this.named) ? slug(this.refName(m.type)) : null,
      });
      sumMembers += size;
      if (!isUnion) expected = Math.max(expected, m.offset + size);
    }
    const padding = isUnion ? 0 : Math.max(0, total - expected);
    return {
      name, kind: n.kind, rows,
      summary: {
        size: total, cachelines: Math.max(1, Math.ceil(total / 64)),
        members: (fl.members || []).length, sumMembers, holes, sumHoles, padding,
        lastCacheline: total % 64 || Math.min(total, 64),
      },
    };
  }

  // render a pahole layout as plain annotated C text (feed to Expressive Code / Shiki)
  paholeText(name) {
    const L = this.paholeLayout(name);
    if (!L) { // enum: fall back to the plain declaration
      return this.plainToplevel(name);
    }
    const strip = (s) => s.replace(/<[^>]+>/g, "");
    const IND = "    ", COL = 52;
    let out = `${L.kind} ${name} {`;
    for (const r of L.rows) {
      if (r.hole != null) {
        out += `\n${IND}/* ${r.hole} ${r.hole === 1 ? "byte" : "bytes"} padding */`;
      } else if (r.cacheline != null) {
        out += `\n\n${IND}/* --- cacheline ${r.cacheline} boundary (${r.bytes} bytes) --- */`;
      } else {
        const suf = strip(r.typeSuf) + (r.bits != null ? ` : ${r.bits}` : "");
        const decl = `${IND}${strip(r.typePre)} ${r.field}${suf};`;
        const pad = " ".repeat(Math.max(2, COL - decl.length));
        out += `\n${decl}${pad}/* 0x${r.offset.toString(16)}  ${r.size} */`;
      }
    }
    out += `\n};`;
    return out;
  }

  usedIn() {
    const rev = {};
    for (const [tname, tidx] of Object.entries(this.named)) {
      const fl = this.get(this.get(tidx).fieldlist);
      const seen = new Set();
      for (const m of fl.members || []) {
        const r = this.refName(m.type);
        if (r && r in this.named && r !== tname) seen.add(r);
      }
      for (const r of seen) (rev[r] ||= new Set()).add(tname);
    }
    const out = {};
    for (const [k, v] of Object.entries(rev)) out[k] = [...v].sort();
    return out;
  }
  byKind() {
    const k = { struct: [], union: [], enum: [] };
    for (const n of Object.keys(this.named).sort()) k[this.get(this.named[n]).kind].push(n);
    return k;
  }
}

export function loadDoc(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
export const MODLABEL = { ntoskrnl: "kernel", ntdll: "userland" };

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
    typeBuilds: (a, m, n) => wizard.get(key(a, m, n)) || [],
  };
  return _cat;
}

const _r = new WeakMap(), _u = new WeakMap(), _s = new WeakMap();
export function rendererFor(doc) {
  if (!_r.has(doc)) _r.set(doc, new Renderer(doc));
  return _r.get(doc);
}
export function usedInFor(doc) {
  if (!_u.has(doc)) _u.set(doc, rendererFor(doc).usedIn());
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
