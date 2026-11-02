// The struct/union/enum panel as HTML: the one place a layout becomes markup (type
// links via html()). Pages don't inline it. Most layouts are identical across builds,
// so each distinct panel is written once as /f/<hash>.html and struct.js fetches it.
// A panel's relative links ("<Type>.html") resolve against the page that loads it;
// identical HTML implies identical links, so a shared panel is valid in every build.
// All interactivity (Metadata toggle, copy, row click-through) is in struct.js.
import { createHash } from "node:crypto";
import { esc, html } from "./types.mjs";
import { structLayout, enumLayout, offAnn, hexv } from "./layout.mjs";
import { catalog, typesFor, typeList } from "./catalog.mjs";

const IND = "    ";
const ind = (d) => IND.repeat(d + 1);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function rowHtml(r, T) {
  if (r.hole != null)
    return `<div class="sc-line sc-hole"><span class="sc-code">${ind(r.depth)}/* ${r.hole} byte${r.hole === 1 ? "" : "s"} padding */</span></div>`;
  if (r.cacheline != null)
    return `<div class="sc-line sc-cache"><span class="sc-code">${ind(r.depth)}/* ── cacheline ${r.cacheline} boundary (${r.bytes} bytes) ── */</span></div>`;
  if (r.open)
    return `<div class="sc-line sc-grp"><span class="sc-code">${ind(r.depth)}<span class="kw">${r.open}</span> {</span></div>`;
  if (r.close)
    return `<div class="sc-line sc-grp"><span class="sc-code">${ind(r.depth)}}${r.field ? ` <span class="sc-field">${esc(r.field)}</span>` : ""};</span><span class="sc-ann">/* 0x${r.offset.toString(16)}  ${r.size} */</span></div>`;
  const bits = r.bits != null ? ` : ${r.bits}` : "";
  return `<div class="sc-member k-${r.fkind}${r.linked ? " link" : ""}"><span class="sc-code">${ind(r.depth)}${html(r.typePre, T)}${r.sep}<span class="sc-field">${esc(r.field)}</span>${html(r.typeSuf, T)}${bits};</span><span class="sc-ann">/* ${offAnn(r)} */</span></div>`;
}

// the panel's inner HTML for a documented type: code view + stats line
export function panelHtml(T, name) {
  const L = structLayout(T, name), E = L ? null : enumLayout(T, name);
  let head, body, stats;
  if (E) {
    head = `<span class="kw">enum</span> ${esc(E.name)} {`;
    body = E.values.map((v) =>
      `<div class="sc-member k-enum"><span class="sc-code">${IND}${esc(v.name)} = ${v.value},</span><span class="sc-ann">/* ${hexv(v.value)} */</span></div>`).join("");
    stats = [[plural(E.summary.values, "value"), ""], ["size", E.summary.size]];
  } else {
    const s = L.summary;
    head = `<span class="kw">${L.kind}</span> ${esc(L.name)} {`;
    body = L.rows.map((r) => rowHtml(r, T)).join("");
    stats = [["size", `${s.size} (0x${s.size.toString(16)})`], [plural(s.members, "member"), ""],
             [plural(s.holes, "hole"), s.holes ? `${s.sumHoles} bytes` : ""], ["padding", s.padding],
             [plural(s.cachelines, "cacheline"), ""]];
  }
  const st = stats.map(([k, v]) => /^\d/.test(k)
    ? `<span><b>${k.split(" ")[0]}</b> ${k.split(" ").slice(1).join(" ")}${v !== "" ? ` (${esc(v)})` : ""}</span>`
    : `<span>${k} <b>${esc(v)}</b></span>`).join("");
  return `<div class="sc" data-sc><pre class="sc-pre"><code><div class="sc-ctrls"><button class="sc-tgl" data-sc-meta aria-pressed="true"><span class="sc-box"></span>Metadata</button><button class="sc-copy" data-sc-copy>copy</button></div>` +
    `<div class="sc-line sc-head"><span class="sc-code">${head}</span></div>${body}<div class="sc-line"><span class="sc-code">};</span></div></code></pre></div>` +
    `<div class="stats">${st}</div>`;
}

// Every distinct panel, once per build: byDoc(doc).get(name) -> hash, and
// rep.get(hash) -> [doc, name] to re-render it for /f/<hash>.html.
let _f = null;
export function fragments() {
  if (_f) return _f;
  const byDoc = new Map(), rep = new Map();
  for (const d of catalog().docs) {
    const T = typesFor(d), m = new Map();
    for (const it of typeList(d)) {
      if (it.o) continue;
      const h = createHash("sha256").update(panelHtml(T, it.n)).digest("hex").slice(0, 16);
      m.set(it.n, h);
      if (!rep.has(h)) rep.set(h, [d, it.n]);
    }
    byDoc.set(d, m);
  }
  return (_f = { byDoc, rep });
}
export const fragmentOf = (doc, name) => fragments().byDoc.get(doc).get(name);
