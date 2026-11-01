import { catalog, typesFor, slugNames } from "../../../../lib/catalog.mjs";
import { slug } from "../../../../lib/types.mjs";

// /ti/<arch>/<build>/<module>.json — the sidebar's type list for one context.
export function getStaticPaths() {
  return catalog().docs.map((d) => ({
    params: { arch: d.arch, build: d.build, module: d.module },
  }));
}

export function GET({ params }) {
  const doc = catalog().get(params.arch, params.build, params.module);
  const T = typesFor(doc);
  const items = slugNames(doc).map((n) => ({ n, k: T.get(doc.named[n]).kind, s: slug(n) }));
  return new Response(JSON.stringify(items), { headers: { "content-type": "application/json" } });
}
