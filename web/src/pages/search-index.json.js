import { catalog, typesFor, slugNames } from "../lib/catalog.mjs";
import { slug } from "../lib/types.mjs";

// /search-index.json — every documented type in every context, for the ⌘K palette.
// Compact keys: n=name k=kind s=slug a=arch b=build m=module
export function GET() {
  const out = [];
  for (const d of catalog().docs) {
    const T = typesFor(d);
    for (const n of slugNames(d)) {
      out.push({ n, k: T.get(d.named[n]).kind, s: slug(n), a: d.arch, b: d.build, m: d.module });
    }
  }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
}
