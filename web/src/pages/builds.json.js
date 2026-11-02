import { catalog } from "../lib/catalog.mjs";

// /builds.json: the context bar's build list, shared by every page.
//   {"<arch>/<module>": [[build, family]]}, builds ascending (= cat.builds order,
//   which each page's data-has string follows)
export function GET() {
  const cat = catalog(), body = {};
  for (const d of cat.docs) {
    const k = d.arch + "/" + d.module;
    body[k] ||= cat.builds(d.arch, d.module).map((b) => [b, cat.get(d.arch, b, d.module).family]);
  }
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
