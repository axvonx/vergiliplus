import { catalog, vrow, product, docTags, tagTitle } from "../lib/catalog.mjs";

// /builds.json: the context bar's build list (and its arches), shared by every page.
//   {"<arch>/<module>": [[build, family, product, release[, label, [[tag, tooltip]]]]]},
//   builds ascending (=
//   cat.builds order, which each page's data-has string follows); see vrow
export function GET() {
  const cat = catalog(), body = {};
  // keys in arch order (cat.archs()): nav.js orders the context bar's arches by them
  const docs = cat.archs().flatMap((a) => cat.docs.filter((d) => d.arch === a));
  for (const d of docs) {
    const k = d.arch + "/" + d.module;
    body[k] ||= cat.builds(d.arch, d.module).map((b) => {
      const x = cat.get(d.arch, b, d.module), p = product(x.family);
      return vrow({ build: b, label: x.buildLabel || b, tags: docTags(x).map((t) => [t, tagTitle(x, t)]) }, [b, x.family, p.product, p.release]);
    });
  }
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
