// Type -> C-declaration renderer. Framework-agnostic ESM: loads a vergiliplus data
// JSON and produces the dracula-coloured, str-link-cross-linked code HTML, the
// pahole-style layout (with anonymous unions/structs reconstructed) and the
// named-type listing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modInfo } from "./modules.mjs";

// pointer width per arch; everything else in BASE_SIZES is LLP64 on every arch
const PTR_SIZE = { x86: 4, x64: 8, arm64: 8, arm: 4 };
const BASE_SIZES = {
  "char": 1, "signed char": 1, "unsigned char": 1, "bool": 1,
  "short": 2, "unsigned short": 2, "wchar_t": 2, "__wchar_t": 2,
  "int": 4, "unsigned int": 4, "long": 4, "unsigned long": 4, "float": 4,
  "__int64": 8, "unsigned __int64": 8, "double": 8, "long long": 8,
};
const ANON = /^<(unnamed|anonymous)-tag>$/;
const KW = new Set(["struct", "union", "enum", "const", "volatile", "void", "char",
  "bool", "short", "int", "long", "float", "double", "signed", "unsigned",
  "__int64", "wchar_t", "__wchar_t"]);

export const esc = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export const slug = (s) => s.replace(/[^A-Za-z0-9_.-]/g, "_");
const hk = (s) => `<span class="kw">${s}</span>`;
const hc = (s) => `<span class="sc-ann">${s}</span>`;
const hn = (s) => s;  // numbers are unstyled; no span keeps ~28k pages lean
// highlight keyword words inside base names too ("unsigned long", "void*")
const kwOrPlain = (n) => esc(n).replace(/[A-Za-z_]\w*/g, (w) => KW.has(w) ? hk(w) : w);

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
  constructor(doc) {
    this.t = doc.types; this.named = doc.named;
    this.ptr = PTR_SIZE[doc.arch] ?? 8;
  }
  get(idx) { return this.t[idx] || { kind: "other" }; }
  derefFwd(idx) {
    const n = this.get(idx);
    if (["struct", "union", "enum"].includes(n.kind) && n.forward) return [n.forward, this.get(n.forward)];
    return [idx, n];
  }
  sizeof(idx) {
    const n = this.get(idx);
    switch (n.kind) {
      case "pointer": return this.ptr;
      case "base": return BASE_SIZES[n.name] ?? (String(n.name).endsWith("*") ? this.ptr : 0);
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
        if (ref.kind === "proc") return [this.renderType(ref.return)[0] + " (*", `)(${this.argList(ref)})`];
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
  // function-pointer parameters; older data has no param list -> "()"
  argList(proc) {
    if (!proc.args) return "";
    const al = this.get(proc.args).args || [];
    if (!al.length) return hk("void");
    return al.map((a) => {
      if (a === "0x0") return "...";
      const [pre, suf] = this.renderType(a);
      return pre + suf;
    }).join(", ");
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
  // split type expression around the field name: decl = `${pre} name${suf}`
  typeParts(idx) {
    const [pre, suf] = this.renderType(idx);
    return { pre: pre.trim(), suf };
  }

  memberKind(idx) {
    const n = this.get(idx);
    if (n.kind === "modifier") return this.memberKind(n.referent);
    if (n.kind === "pointer" && this.get(n.referent).kind === "proc") return "proc";
    if (n.kind === "bitfield") return "bitfield";
    if (n.kind === "base") return String(n.name).endsWith("*") ? "pointer" : "base";
    return n.kind; // pointer | array | struct | union | enum | proc
  }

  // Field members -> storage units. A unit is one non-bitfield member, or a run of
  // bitfields sharing a storage word (same offset and size, bit position moving up).
  // A bitfield whose position doesn't move up starts a new unit — that's an
  // alternative bitfield set in an anonymous union. Old data without `pos`
  // packs by declared widths instead.
  units(members) {
    const out = [];
    for (const m of members) {
      const node = this.get(m.type);
      if (node.kind !== "bitfield") {
        const size = this.sizeof(m.type);
        out.push({ bf: false, offset: m.offset, size, end: m.offset + size, ms: [{ m }] });
        continue;
      }
      const size = this.sizeof(node.type);
      const last = out[out.length - 1];
      const pos = node.pos ?? (last && last.bf && last.offset === m.offset ? last.next : 0);
      if (last && last.bf && last.offset === m.offset && last.size === size &&
          pos >= last.next && pos + node.bits <= size * 8) {
        last.ms.push({ m, pos }); last.next = pos + node.bits;
      } else {
        out.push({ bf: true, offset: m.offset, size, end: m.offset + size,
                   ms: [{ m, pos }], next: pos + node.bits });
      }
    }
    return out;
  }

  // Reconstruct anonymous unions/structs from flat units [lo, hi). The PDB flattens
  // them into the parent's field list, so: a unit whose offset is revisited by a later
  // unit opens a union; its alternatives start at each revisit; an alternative of more
  // than one unit is an anonymous struct. Offsets are exact either way; the one
  // ambiguity is a last alternative longer than the others, whose tail lands after
  // the union.
  structItems(us, lo, hi) {
    const items = [];
    let i = lo;
    while (i < hi) {
      const O = us[i].offset;
      let r = i;
      for (let k = i + 1; k < hi && us[k].offset >= O; k++) if (us[k].offset === O) r = k;
      if (r === i) { items.push({ unit: us[i], offset: O, end: us[i].end }); i++; continue; }
      let end = O;
      for (let k = i; k <= r; k++) end = Math.max(end, us[k].end);
      let k = r + 1;
      while (k < hi && us[k].offset < end) { end = Math.max(end, us[k].end); k++; }
      items.push({ union: this.alternatives(us, i, k, O), offset: O, end });
      i = k;
    }
    return items;
  }
  alternatives(us, lo, hi, O) {
    const starts = [];
    for (let k = lo; k < hi; k++) if (us[k].offset === O) starts.push(k);
    starts.push(hi);
    const alts = [];
    for (let a = 0; a < starts.length - 1; a++) {
      const s = starts[a], e = starts[a + 1];
      alts.push(e - s === 1 && us[s].ms.length === 1
        ? { unit: us[s] }
        : { struct: this.structItems(us, s, e) });
    }
    return alts;
  }

  // pahole-style layout: rows of members (with depth), anonymous union/struct
  // open/close rows, explicit holes, cacheline markers, plus a summary footer
  paholeLayout(name) {
    const idx = this.named[name], n = this.get(idx);
    if (!["struct", "union"].includes(n.kind)) return null;
    const members = this.get(n.fieldlist).members || [];
    const total = n.size || this.sizeof(idx);
    const us = this.units(members);
    const rows = [];
    const st = { holes: 0, sumHoles: 0, lastLine: 0, sum: 0 };
    const hx = (x) => "0x" + x.toString(16);

    const member = ({ m, pos }, depth) => {
      const node = this.get(m.type);
      const bf = node.kind === "bitfield";
      // a named member of anonymous type ("struct <unnamed-tag> u;"): inline its body
      if (["struct", "union"].includes(node.kind)) {
        const [, d] = this.derefFwd(m.type);
        if (ANON.test(d.name || node.name || "") && d.fieldlist) {
          const shifted = (this.get(d.fieldlist).members || [])
            .map((x) => ({ ...x, offset: x.offset + m.offset }));
          const nus = this.units(shifted);
          rows.push({ depth, open: d.kind, offset: m.offset });
          if (d.kind === "union") emitAlts(this.alternatives(nus, 0, nus.length, m.offset), depth + 1);
          else emitStruct(this.structItems(nus, 0, nus.length), depth + 1, false);
          rows.push({ depth, close: true, field: m.name, offset: m.offset, size: this.sizeof(m.type) });
          return;
        }
      }
      const tp = this.typeParts(bf ? node.type : m.type);
      const ref = this.refName(m.type);
      rows.push({
        depth, typePre: tp.pre, typeSuf: tp.suf, sep: tp.pre.endsWith("(*") ? "" : " ",
        fkind: this.memberKind(m.type), field: m.name, offset: m.offset,
        size: bf ? this.sizeof(node.type) : this.sizeof(m.type),
        bits: bf ? node.bits : null, bitpos: bf ? pos : null,
        ref, reflink: ref in this.named ? slug(ref) : null,
      });
    };
    const emitUnit = (u, depth) => u.ms.forEach((x) => member(x, depth));
    const emitStruct = (items, depth, top) => {
      let expected = items.length ? items[0].offset : 0;
      for (const it of items) {
        if (it.offset > expected) {
          const h = it.offset - expected;
          rows.push({ depth, hole: h });
          st.holes++; st.sumHoles += h;
        }
        // one marker before the first top-level item starting in a new cacheline
        // (O(members), even for 276 MB structs like _MI_HYPER_SPACE)
        const line = Math.floor(it.offset / 64);
        if (top && total > 64 && line > st.lastLine) {
          rows.push({ depth, cacheline: line, bytes: line * 64 });
          st.lastLine = line;
        }
        if (it.unit) emitUnit(it.unit, depth); else emitUnion(it, depth);
        if (top) st.sum += it.end - it.offset;
        expected = Math.max(expected, it.end);
      }
      return expected;
    };
    const emitUnion = (it, depth) => {
      rows.push({ depth, open: "union", offset: it.offset });
      emitAlts(it.union, depth + 1);
      rows.push({ depth, close: true, offset: it.offset, size: it.end - it.offset });
    };
    const emitAlts = (alts, depth) => {
      for (const alt of alts) {
        if (alt.unit) { emitUnit(alt.unit, depth); continue; }
        const first = alt.struct[0], last = alt.struct[alt.struct.length - 1];
        rows.push({ depth, open: "struct", offset: first.offset });
        emitStruct(alt.struct, depth + 1, false);
        rows.push({ depth, close: true, offset: first.offset, size: last.end - first.offset });
      }
    };

    let used;
    if (n.kind === "union") {
      emitAlts(this.alternatives(us, 0, us.length, us.length ? us[0].offset : 0), 0);
      used = us.reduce((e, u) => Math.max(e, u.end), 0);
    } else {
      used = emitStruct(this.structItems(us, 0, us.length), 0, true);
    }
    const sumMembers = n.kind === "union" ? used : st.sum;
    return {
      name, kind: n.kind, rows,
      summary: {
        size: total, cachelines: Math.max(1, Math.ceil(total / 64)),
        members: members.length, sumMembers, holes: st.holes, sumHoles: st.sumHoles,
        padding: n.kind === "union" ? 0 : Math.max(0, total - used),
        lastCacheline: total % 64 || Math.min(total, 64),
      },
    };
  }

  // enum value table
  enumLayout(name) {
    const idx = this.named[name], n = this.get(idx);
    if (n.kind !== "enum") return null;
    const values = (this.get(n.fieldlist).enums || []).map((e) => ({ name: e.name, value: e.value }));
    return { name, kind: "enum", values, summary: { values: values.length, size: this.sizeof(idx) } };
  }

  // the C text of a layout (copy button, golden tests); meta=false drops annotations
  paholeText(name, meta = true) {
    const strip = (s) => s.replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const IND = "    ", COL = 60;
    const E = this.enumLayout(name);
    if (E) {
      let out = `enum ${name} {`;
      for (const v of E.values) {
        const line = `${IND}${v.name} = ${v.value},`;
        out += "\n" + (meta ? line + " ".repeat(Math.max(2, COL - line.length)) + `/* ${hexv(v.value)} */` : line);
      }
      return out + "\n};";
    }
    const L = this.paholeLayout(name);
    if (!L) throw new Error(`no struct/union/enum named ${name}`);
    let out = `${L.kind} ${name} {`;
    const ann = (line, a) => meta ? line + " ".repeat(Math.max(2, COL - line.length)) + `/* ${a} */` : line;
    for (const r of L.rows) {
      const ind = IND.repeat(r.depth + 1);
      if (r.hole != null) {
        if (meta) out += `\n${ind}/* ${r.hole} ${r.hole === 1 ? "byte" : "bytes"} padding */`;
      } else if (r.cacheline != null) {
        if (meta) out += `\n\n${ind}/* --- cacheline ${r.cacheline} boundary (${r.bytes} bytes) --- */`;
      } else if (r.open) {
        out += `\n${ind}${r.open} {`;
      } else if (r.close) {
        out += "\n" + ann(`${ind}}${r.field ? " " + r.field : ""};`, `0x${r.offset.toString(16)}  ${r.size}`);
      } else {
        const suf = strip(r.typeSuf) + (r.bits != null ? ` : ${r.bits}` : "");
        out += "\n" + ann(`${ind}${strip(r.typePre)}${r.sep}${r.field}${suf};`, offAnn(r));
      }
    }
    return out + `\n};`;
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
}

// "/* 0x18  8 */" offset annotation; bitfields carry their bit position: 0x18:3
export const offAnn = (r) =>
  `0x${r.offset.toString(16)}${r.bitpos != null ? ":" + r.bitpos : ""}  ${r.size}`;
export const hexv = (v) => (v < 0 ? "-0x" + (-v).toString(16) : "0x" + v.toString(16));

export function loadDoc(p) {
  const doc = JSON.parse(fs.readFileSync(p, "utf8"));
  // "<unnamed-tag>" is MSVC's name for every anonymous aggregate: not a real type
  for (const n of Object.keys(doc.named)) if (ANON.test(n)) delete doc.named[n];
  return doc;
}
export { modInfo };

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
export const versionPath = (a, b) => `/v/${a}/${b}.html`;

// release channel from the family name, for colour-coding versions
export const channel = (family) =>
  /server/i.test(family) ? "server" : /canary|insider|dev|beta|preview/i.test(family) ? "insider" : "client";
