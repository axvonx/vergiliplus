// Struct layout reconstruction over a type graph (types.mjs): pahole-style rows with
// anonymous unions/structs rebuilt from the PDB's flat field lists, enum tables,
// the plain-C text of a layout, and the reverse "used in" index.
import { ANON, text } from "./types.mjs";

// Field members -> storage units. A unit is one non-bitfield member, or a run of
// bitfields sharing a storage word (same offset and size, bit position moving up).
// A bitfield whose position doesn't move up starts a new unit — that's an
// alternative bitfield set in an anonymous union. Old data without `pos`
// packs by declared widths instead.
function units(T, members) {
  const out = [];
  for (const m of members) {
    const node = T.get(m.type);
    if (node.kind !== "bitfield") {
      const size = T.sizeof(m.type);
      out.push({ bf: false, offset: m.offset, size, end: m.offset + size, ms: [{ m }] });
      continue;
    }
    const size = T.sizeof(node.type);
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
function structItems(T, us, lo, hi) {
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
    items.push({ union: alternatives(T, us, i, k, O), offset: O, end });
    i = k;
  }
  return items;
}
function alternatives(T, us, lo, hi, O) {
  const starts = [];
  for (let k = lo; k < hi; k++) if (us[k].offset === O) starts.push(k);
  starts.push(hi);
  const alts = [];
  for (let a = 0; a < starts.length - 1; a++) {
    const s = starts[a], e = starts[a + 1];
    alts.push(e - s === 1 && us[s].ms.length === 1
      ? { unit: us[s] }
      : { struct: structItems(T, us, s, e) });
  }
  return alts;
}

// pahole-style layout: rows of members (with depth), anonymous union/struct
// open/close rows, explicit holes, cacheline markers, plus a summary footer
export function structLayout(T, name) {
  const idx = T.named[name], n = T.get(idx);
  if (!["struct", "union"].includes(n.kind)) return null;
  const members = T.get(n.fieldlist).members || [];
  const total = n.size || T.sizeof(idx);
  const us = units(T, members);
  const rows = [];
  const st = { holes: 0, sumHoles: 0, lastLine: 0, sum: 0 };
  const hx = (x) => "0x" + x.toString(16);

  const member = ({ m, pos }, depth) => {
    const node = T.get(m.type);
    const bf = node.kind === "bitfield";
    // a named member of anonymous type ("struct <unnamed-tag> u;"): inline its body
    if (["struct", "union"].includes(node.kind)) {
      const [, d] = T.derefFwd(m.type);
      if (ANON.test(d.name || node.name || "") && d.fieldlist) {
        const shifted = (T.get(d.fieldlist).members || [])
          .map((x) => ({ ...x, offset: x.offset + m.offset }));
        const nus = units(T, shifted);
        rows.push({ depth, open: d.kind, offset: m.offset });
        if (d.kind === "union") emitAlts(alternatives(T, nus, 0, nus.length, m.offset), depth + 1);
        else emitStruct(structItems(T, nus, 0, nus.length), depth + 1, false);
        rows.push({ depth, close: true, field: m.name, offset: m.offset, size: T.sizeof(m.type) });
        return;
      }
    }
    const tp = T.typeParts(bf ? node.type : m.type);
    const ref = T.refName(m.type);
    rows.push({
      depth, typePre: tp.pre, typeSuf: tp.suf, sep: text(tp.pre).endsWith("(*") ? "" : " ",
      fkind: T.memberKind(m.type), field: m.name, offset: m.offset,
      size: bf ? T.sizeof(node.type) : T.sizeof(m.type),
      bits: bf ? node.bits : null, bitpos: bf ? pos : null,
      ref, linked: T.hasPage(ref),
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
    emitAlts(alternatives(T, us, 0, us.length, us.length ? us[0].offset : 0), 0);
    used = us.reduce((e, u) => Math.max(e, u.end), 0);
  } else {
    used = emitStruct(structItems(T, us, 0, us.length), 0, true);
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
export function enumLayout(T, name) {
  const idx = T.named[name], n = T.get(idx);
  if (n.kind !== "enum") return null;
  const values = (T.get(n.fieldlist).enums || []).map((e) => ({ name: e.name, value: e.value }));
  return { name, kind: "enum", values, summary: { values: values.length, size: T.sizeof(idx) } };
}

// named type -> the named types whose members reference it (directly, via
// pointers/arrays, or from inside members of anonymous "<unnamed-tag>" type,
// which belong to the enclosing type)
export function usedIn(T) {
  const rev = {};
  const walk = (flIdx, tname, seen, depth) => {
    for (const m of T.get(flIdx).members || []) {
      const r = T.refName(m.type);
      if (r && T.hasPage(r)) { if (r !== tname) seen.add(r); continue; }
      // descend into an anonymous aggregate, through pointers/arrays/modifiers
      let idx = m.type, n = T.get(idx);
      while (["pointer", "modifier", "array", "bitfield"].includes(n.kind)) {
        idx = n.referent ?? n.element ?? n.type; n = T.get(idx);
      }
      if (!["struct", "union"].includes(n.kind)) continue;
      const [, d] = T.derefFwd(idx);
      if (ANON.test(d.name || "") && d.fieldlist && depth < 8) walk(d.fieldlist, tname, seen, depth + 1);
    }
  };
  for (const [tname, tidx] of Object.entries(T.named)) {
    const seen = new Set();
    walk(T.get(tidx).fieldlist, tname, seen, 0);
    for (const r of seen) (rev[r] ||= new Set()).add(tname);
  }
  const out = {};
  for (const [k, v] of Object.entries(rev)) out[k] = [...v].sort();
  return out;
}
// the C text of a layout (copy button, golden tests); meta=false drops annotations
export function layoutText(T, name, meta = true) {
  const IND = "    ", COL = 60;
  const ann = (line, a) => meta ? line + " ".repeat(Math.max(2, COL - line.length)) + `/* ${a} */` : line;
  const p = T.provenance?.(name), prov = p ? `\n/* ${p} */` : "";
  const E = enumLayout(T, name);
  if (E) {
    let out = `enum ${name} {`;
    for (const v of E.values) out += "\n" + ann(`${IND}${v.name} = ${v.value},`, hexv(v.value));
    return out + "\n};" + prov;
  }
  const L = structLayout(T, name);
  if (!L) throw new Error(`no struct/union/enum named ${name}`);
  let out = `${L.kind} ${name} {`;
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
      const bits = r.bits != null ? ` : ${r.bits}` : "";
      out += "\n" + ann(`${ind}${text(r.typePre)}${r.sep}${r.field}${text(r.typeSuf)}${bits};`, offAnn(r));
    }
  }
  return out + "\n};" + prov;
}

// "/* 0x18  8 */" offset annotation; bitfields carry their bit position: 0x18:3
export const offAnn = (r) =>
  `0x${r.offset.toString(16)}${r.bitpos != null ? ":" + r.bitpos : ""}  ${r.size}`;
export const hexv = (v) => (v < 0 ? "-0x" + (-v).toString(16) : "0x" + v.toString(16));
