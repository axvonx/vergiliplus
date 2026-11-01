import { catalog, typeList, channel } from "../lib/catalog.mjs";

// /search-index.json — the search palette's data, grouped by type:
//   v: [[arch, build, family, channel]]   versions, newest first
//   m: [module]
//   t: [[name, kind, slug, module#, [version# defining it], [version# where opaque]]]
export function GET() {
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
  const body = {
    v: v.map((x) => [x.arch, x.build, x.family, channel(x.family)]),
    m,
    t: [...t.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[3] - b[3])),
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
