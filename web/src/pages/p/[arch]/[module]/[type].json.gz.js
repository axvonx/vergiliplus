import { gzipSync } from "node:zlib";
import { typePages, packOf } from "../../../../lib/panel.mjs";

// /p/<arch>/<module>/<slug>.json.gz: every build's view of one type, each distinct view
// once (lib/panel.mjs packOf). Gzipped at build time because Pages stores files as-is;
// struct.js inflates it with DecompressionStream.
export function getStaticPaths() {
  return typePages().map((page) => ({ params: { arch: page.arch, module: page.module, type: page.slug }, props: { page } }));
}

export function GET({ props }) {
  return new Response(gzipSync(JSON.stringify(packOf(props.page)), { level: 9 }),
    { headers: { "content-type": "application/gzip" } });
}
