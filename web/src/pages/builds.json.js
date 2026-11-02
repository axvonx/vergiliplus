import { catalog, vrow, product } from "../lib/catalog.mjs";

// /builds.json: the context bar's build list, shared by every page.
//   {"<arch>/<module>": [[build, family, product, release[, label, incomplete]]]}, builds ascending (=
//   cat.builds order, which each page's data-has string follows); see vrow
export function GET() {
  const cat = catalog(), body = {};
  for (const d of cat.docs) {
    const k = d.arch + "/" + d.module;
    body[k] ||= cat.builds(d.arch, d.module).map((b) => {
      const x = cat.get(d.arch, b, d.module), p = product(x.family);
      return vrow({ build: b, label: x.buildLabel || b, inc: x.incomplete }, [b, x.family, p.product, p.release]);
    });
  }
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
