import { catalog, typeList } from "../../../../lib/catalog.mjs";

// /ti/<arch>/<build>/<module>.json — the sidebar's type list for one context.
export function getStaticPaths() {
  return catalog().docs.map((d) => ({
    params: { arch: d.arch, build: d.build, module: d.module },
  }));
}

export function GET({ params }) {
  const doc = catalog().get(params.arch, params.build, params.module);
  // o: 1 for opaque (declared/mentioned only) names
  const items = typeList(doc).map((it) => (it.o ? { n: it.n, k: it.k, s: it.s, o: 1 } : { n: it.n, k: it.k, s: it.s }));
  return new Response(JSON.stringify(items), { headers: { "content-type": "application/json" } });
}
