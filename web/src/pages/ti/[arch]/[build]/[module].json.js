import { catalog, typeList } from "../../../../lib/catalog.mjs";

// /ti/<arch>/<build>/<module>.json — the sidebar's type list for one context.
export function getStaticPaths() {
  return catalog().docs.map((d) => ({
    params: { arch: d.arch, build: d.build, module: d.module },
  }));
}

export function GET({ params }) {
  const doc = catalog().get(params.arch, params.build, params.module);
  // o: 1 for opaque (declared/mentioned only) names; a: 1 named only, by ASSERT text
  const items = typeList(doc).map((it) => ({ n: it.n, k: it.k, s: it.s, ...(it.o && { o: 1 }), ...(it.a && { a: 1 }) }));
  return new Response(JSON.stringify(items), { headers: { "content-type": "application/json" } });
}
