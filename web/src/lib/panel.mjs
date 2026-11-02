// Type pages: one page per arch x module x type, every build in it. The page inlines its
// default build's view (newest defining build, else newest declaring it); the others come
// from a per-type pack, /p/<arch>/<module>/<slug>.json.gz, fetched by struct.js on a build
// switch. Layouts barely change across builds, so a pack holds each distinct view once.
// This module is the one place a layout becomes markup (type links via html()). Relative
// links ("<Type>.html") resolve within the module's /t/ dir; struct.js appends #<build>.
import { esc, html, slug } from "./types.mjs";
import { structLayout, enumLayout, offAnn, hexv } from "./layout.mjs";
import { catalog, typesFor, typeList, usedInFor, cmpBuild } from "./catalog.mjs";

const IND = "    ";
const ind = (d) => IND.repeat(d + 1);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const typePath = (arch, module, name) => `/t/${arch}/${module}/${slug(name)}.html`;

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

// a documented type's view: code + stats line
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

// an opaque name's view in one build: its declaration, and where it does have a layout
// (other modules of this build first, then other builds, newest first)
export function opaqueHtml(doc, name, kind) {
  const defs = catalog().docs
    .filter((d) => d.arch === doc.arch && name in d.named)
    .sort((x, y) => ((y.build === doc.build) - (x.build === doc.build)) || cmpBuild(y.build, x.build) ||
      (x.module < y.module ? -1 : 1));
  return `<pre class="sc-pre"><code><div class="sc-line"><span class="sc-code"><span class="kw">${esc(kind)}</span> ${esc(name)};</span><span class="sc-ann">/* opaque */</span></div></code></pre>` +
    `<p class="opaque-note">Declared but not defined in <b>${esc(doc.module)}</b>'s public PDB for this build: a forward ` +
    `declaration, or a name that only appears in mangled C++ symbols. The layout isn't public here.</p>` +
    (defs.length ? `<div class="defined-in">Defined in: ${defs.map((d) =>
      `<a href="${esc(typePath(d.arch, d.module, name))}#${esc(d.build)}">${esc(d.module)} ${esc(d.build)}</a>`).join("")}</div>` : "");
}

// Every type page: [{arch, module, name, slug, aliases, kind, builds, has, def, names}].
// builds is cat.builds(arch, module); has has one char per build: d defined, o opaque,
// - absent; names maps build -> that build's spelling. Names whose slugs differ only by
// case are one page when no build has both (Microsoft renames case, e.g.
// _TlgProvider_t -> _tlgProvider_t, and a case-insensitive disk can't hold both): name
// and slug are the newest spelling's, aliases the other slugs (same page, own file).
// Otherwise the first name in sorted order claims the slug.
let _pages = null;
export function typePages() {
  if (_pages) return _pages;
  const cat = catalog(), groups = new Map();
  for (const d of cat.docs) {
    for (const it of typeList(d)) {
      const k = d.arch + "|" + d.module + "|" + it.s.toLowerCase();
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { arch: d.arch, module: d.module, by: new Map() }));
      let p = g.by.get(it.n);
      if (!p) g.by.set(it.n, (p = { name: it.n, slug: it.s, kind: it.k, st: new Map() }));
      if (!it.o) p.kind = it.k;  // a definition's kind wins over a declaration's
      p.st.set(d.build, it.o ? "o" : "d");
    }
  }
  const out = [];
  for (const g of groups.values()) {
    const builds = cat.builds(g.arch, g.module);
    let ps = [...g.by.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const clash = builds.some((b) => ps.filter((p) => p.st.has(b)).length > 1);
    if (clash) ps = [ps[0]];
    const names = new Map(), st = new Map();
    for (const p of ps) for (const [b, x] of p.st) { names.set(b, p.name); st.set(b, x); }
    const has = builds.map((b) => st.get(b) || "-").join("");
    const di = has.lastIndexOf("d"), def = builds[di >= 0 ? di : has.lastIndexOf("o")];
    const main = ps.find((p) => p.name === names.get(def));
    const kind = ps.find((p) => [...p.st.values()].includes("d"))?.kind || main.kind;
    out.push({ arch: g.arch, module: g.module, name: main.name, slug: main.slug,
               aliases: ps.filter((p) => p !== main).map((p) => p.slug), kind, builds, has, def, names });
  }
  return (_pages = out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}

// one build's view of a type page: {view: html, used: [names]} (null where absent)
export function viewOf(page, build) {
  const st = page.has[page.builds.indexOf(build)];
  if (st === "-" || st == null) return null;
  const doc = catalog().get(page.arch, build, page.module), name = page.names.get(build);
  return {
    view: st === "d" ? panelHtml(typesFor(doc), name) : opaqueHtml(doc, name, page.kind),
    used: usedInFor(doc)[name] || [],
  };
}

// a type's pack: {n: [build], v: [view html], u: [[used-in names]], b: [[v#, u#] | 0 per n]}
export function packOf(page) {
  const v = [], u = [], vi = new Map(), ui = new Map();
  const idx = (arr, map, x, key) => (map.has(key) ? map.get(key) : (map.set(key, arr.length), arr.push(x), arr.length - 1));
  const b = page.builds.map((build) => {
    const x = viewOf(page, build);
    return x ? [idx(v, vi, x.view, x.view), idx(u, ui, x.used, x.used.join("\n"))] : 0;
  });
  return { n: page.builds, v, u, b };
}
