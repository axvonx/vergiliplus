import { searchRows } from "../lib/catalog.mjs";

// /search-index.json — the search palette's data, grouped by type:
//   v: [[arch, build, family, channel]]   versions, newest first
//   m: [module]
//   t: [[name, kind, slug, module#, [version# defining it], [version# where opaque]]]
export function GET() {
  return new Response(JSON.stringify(searchRows()), { headers: { "content-type": "application/json" } });
}
