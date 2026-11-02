import { catalog, vrow } from "../lib/catalog.mjs";

// /builds.json: the context bar's build list, shared by every page.
//   {"<arch>/<module>": [[build, family[, label, incomplete]]]}, builds ascending (=
//   cat.builds order, which each page's data-has string follows); see vrow
export function GET() {
  const cat = catalog(), body = {};
  for (const d of cat.docs) {
    const k = d.arch + "/" + d.module;
    body[k] ||= cat.builds(d.arch, d.module).map((b) => {
      const x = cat.get(d.arch, b, d.module);
      return vrow({ build: b, label: x.buildLabel || b, inc: x.incomplete }, [b, x.family]);
    });
  }
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
