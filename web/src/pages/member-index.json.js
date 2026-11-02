import { catalog, searchRows } from "../lib/catalog.mjs";
import { ANON } from "../lib/types.mjs";

// /member-index.json — the palette's member filter (loaded only when it is on):
//   f: [[member or enumerator name, [t# of /search-index.json having it in some build]]]
// Members of anonymous unions/structs count as the enclosing type's (they're accessed
// as its fields).
export function GET() {
  const { m, t } = searchRows();
  const row = new Map(t.map((r, i) => [r[0] + "|" + r[3], i]));
  const by = new Map();
  const add = (field, ti) => (by.get(field) || by.set(field, new Set()).get(field)).add(ti);
  for (const d of catalog().docs) {
    const mi = m.indexOf(d.module);
    const walk = (k, ti, depth) => {
      let n = d.types[k];
      if (n?.forward && !n.fieldlist) n = d.types[n.forward] || n;
      const fl = n && d.types[n.fieldlist];
      if (!fl) return;
      for (const mem of fl.members || []) {
        add(mem.name, ti);
        const mt = d.types[mem.type];
        if (mt && (mt.kind === "struct" || mt.kind === "union") && ANON.test(mt.name || "") && depth < 8) walk(mem.type, ti, depth + 1);
      }
      for (const e of fl.enums || []) add(e.name, ti);
    };
    for (const [name, k] of Object.entries(d.named)) {
      const ti = row.get(name + "|" + mi);
      if (ti != null) walk(k, ti, 0);
    }
  }
  const f = [...by].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([n, s]) => [n, [...s].sort((a, b) => a - b)]);
  return new Response(JSON.stringify({ f }), { headers: { "content-type": "application/json" } });
}
