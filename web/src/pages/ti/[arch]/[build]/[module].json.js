import { catalog, rendererFor, slugNames, slug } from "../../../../lib/render.mjs";

// /ti/<arch>/<build>/<module>.json — the sidebar's type list for one context.
export function getStaticPaths() {
  return catalog().docs.map((d) => ({
    params: { arch: d.arch, build: d.build, module: d.module },
  }));
}

export function GET({ params }) {
  const doc = catalog().get(params.arch, params.build, params.module);
  const r = rendererFor(doc);
  const items = slugNames(doc).map((n) => ({ n, k: r.get(doc.named[n]).kind, s: slug(n) }));
  return new Response(JSON.stringify(items), { headers: { "content-type": "application/json" } });
}
