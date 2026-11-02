import { fragments, panelHtml } from "../../lib/panel.mjs";
import { typesFor } from "../../lib/catalog.mjs";

// /f/<hash>.html: one struct panel, shared by every build whose layout renders the same
// (see lib/panel.mjs). A fragment, not a page: struct.js injects it into the type page.
export function getStaticPaths() {
  return [...fragments().rep.keys()].map((hash) => ({ params: { hash } }));
}

export function GET({ params }) {
  const [doc, name] = fragments().rep.get(params.hash);
  return new Response(panelHtml(typesFor(doc), name), { headers: { "content-type": "text/html" } });
}
