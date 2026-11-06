import { catalog, searchRows } from "../lib/catalog.mjs";
import { Types, text, ANON } from "../lib/types.mjs";

// /member-index.json — the palette's member filter (loaded only when it is on):
//   y: [interned member type strings]
//   f: [[member or enumerator name, [[t# of searchRows, y# | null], ...]]]
// Members of anonymous unions/structs count as the enclosing type's (they're accessed
// as its fields).
export function GET() {
  const { m, t } = searchRows();
  const row = new Map(t.map((r, i) => [r[0] + "|" + r[3], i]));
  const by = new Map();
  const cat = catalog();
  const v = cat.versions();
  const vi = new Map(v.map((x, i) => [x.arch + "/" + x.build, i]));
  // walk docs newest first so the member type string reflects the newest defining build
  const docs = [...cat.docs].sort((a, b) => (vi.get(a.arch + "/" + a.build) ?? 999) - (vi.get(b.arch + "/" + b.build) ?? 999));

  for (const d of docs) {
    const mi = m.indexOf(d.module);
    const T = new Types(d);
    const walk = (k, ti, depth) => {
      let n = d.types[k];
      if (n?.forward && !n.fieldlist) n = d.types[n.forward] || n;
      const fl = n && d.types[n.fieldlist];
      if (!fl) return;
      for (const mem of fl.members || []) {
        let ts = "";
        if (mem.type) {
          const parts = T.typeParts(mem.type);
          ts = text(parts.pre) + (parts.suf.length ? " " + text(parts.suf) : "");
        }
        let mmap = by.get(mem.name);
        if (!mmap) { mmap = new Map(); by.set(mem.name, mmap); }
        if (!mmap.has(ti) || (!mmap.get(ti) && ts)) mmap.set(ti, ts);
        const mt = d.types[mem.type];
        if (mt && (mt.kind === "struct" || mt.kind === "union") && ANON.test(mt.name || "") && depth < 8) walk(mem.type, ti, depth + 1);
      }
      for (const e of fl.enums || []) {
        let mmap = by.get(e.name);
        if (!mmap) { mmap = new Map(); by.set(e.name, mmap); }
        if (!mmap.has(ti)) mmap.set(ti, "");
      }
    };
    for (const [name, k] of Object.entries(d.named)) {
      const ti = row.get(name + "|" + mi);
      if (ti != null) walk(k, ti, 0);
    }
  }

  const typeMap = new Map();
  const intern = (s) => {
    let id = typeMap.get(s);
    if (id === undefined) {
      id = typeMap.size;
      typeMap.set(s, id);
    }
    return id;
  };

  for (const mmap of by.values()) {
    for (const ts of mmap.values()) {
      if (ts) intern(ts);
    }
  }

  const f = [...by].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([n, mmap]) => [
    n,
    [...mmap].sort((a, b) => a[0] - b[0]).map(([ti, ts]) => (ts ? [ti, typeMap.get(ts)] : [ti])),
  ]);

  return new Response(JSON.stringify({ y: [...typeMap.keys()], f }), { headers: { "content-type": "application/json" } });
}
