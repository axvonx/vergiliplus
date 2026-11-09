// Type pages: one page per arch x module x type, every build in it. The page inlines its
// default build's view (newest defining build, else newest declaring it); the others come
// from a per-type pack, /p/<arch>/<module>/<slug>.json.gz, fetched by struct.js on a build
// switch. Layouts barely change across builds, so a pack holds each distinct view once.
// This module is the one place a layout becomes markup (type links via html()). Relative
// links ("<Type>.html") resolve within the module's /t/ dir; struct.js appends #<build>.
import { esc, html, slug } from "./types.mjs";
import { structLayout, enumLayout, offAnn, hexv } from "./layout.mjs";
import { catalog, typesFor, typeList, usedInFor, cmpBuild, TAGS, buildName } from "./catalog.mjs";

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
  return `<div class="sc-member k-${r.fkind}${r.linked ? " link" : ""}"><span class="sc-code">${ind(r.depth)}${html(r.typePre, T)}${r.sep}<span class="sc-field">${esc(r.field)}</span>${html(r.typeSuf, T)}${bits};</span>${r.bare ? "" : `<span class="sc-ann">/* ${offAnn(r)} */</span>`}</div>`;
}

// a documented type's view: code + stats line. A layout not from a public PDB carries its
// source tag (linking the build's sources panel) and ends with its short provenance as a
// last code line (so copy carries it); the build's own gaps are the context bar's.
// A type the sources define in more than one way (doc.variants) shows every definition,
// one at a time, picked from a select (struct.js switches them).
export function panelHtml(T, name, doc = null) {
  const vs = doc?.variants?.[name];
  if (!vs) return layoutHtml(T, name, doc);
  const base = T.provenance(name);
  const views = vs.map((v) => {
    const TV = Object.create(T);  // the same doc, with this definition under the name
    TV.named = { ...T.named, [name]: v.type };
    TV.provenance = (n) => (n === name ? `${base ? base + "; " : ""}this definition: ${v.note}` : T.provenance(n));
    return { v, T: TV, size: TV.sizeof(v.type) };
  });
  return `<div data-vars><p class="var-note"><span class="var">${vs.length} variants</span> the sources disagree: ` +
    `<select class="var-sel" data-var-sel aria-label="Definition">${views.map((x, i) =>
      `<option value="${i}">${esc(x.v.note)} (${x.size} bytes)</option>`).join("")}</select></p>` +
    views.map((x, i) => `<div class="var-view" data-var="${i}"${i ? " hidden" : ""}>${layoutHtml(x.T, name, doc)}</div>`).join("") +
    `</div>`;
}

// a source tag linking the build's sources panel; the tooltip says what it means and,
// given a cite, which source
export const tagHtml = (doc, tag, cite) =>
  `<a class="tag t-${tag}" href="${esc(ctxHref(doc))}#sources" title="${esc(TAGS[tag] + (cite ? "\n· " + cite : ""))}">${tag}</a>`;
const ctxHref = (doc) => `/v/${doc.arch}/${doc.build}/${doc.module}.html`;

// one layout's code + stats
function layoutHtml(T, name, doc) {
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
    stats = s.untyped ? [[plural(s.members, "member"), ""], ["size", "unknown"]]
      : [["size", `${s.size} (0x${s.size.toString(16)})`], [plural(s.members, "member"), ""],
             [plural(s.holes, "hole"), s.holes ? `${s.sumHoles} bytes` : ""], ["padding", s.padding],
             [plural(s.cachelines, "cacheline"), ""]];
  }
  const st = stats.map(([k, v]) => /^\d/.test(k)
    ? `<span><b>${k.split(" ")[0]}</b> ${k.split(" ").slice(1).join(" ")}${v !== "" ? ` (${esc(v)})` : ""}</span>`
    : `<span>${k} <b>${esc(v)}</b></span>`).join("");
  const p = T.provenance(name), tag = doc && T.provTag(name);
  return `<div class="sc meta-off" data-sc><pre class="sc-pre"><code><div class="sc-ctrls">${tag ? tagHtml(doc, tag, p) : ""}<button class="sc-tgl" data-sc-meta aria-pressed="false"><span class="sc-box"></span>Metadata</button><button class="sc-copy" data-sc-copy>copy</button></div>` +
    `<div class="sc-line sc-head"><span class="sc-code">${head}</span></div>${body}<div class="sc-line"><span class="sc-code">};</span></div>` +
    (p ? `<div class="sc-line sc-prov"><span class="sc-code">/* ${esc(p)} */</span></div>` : "") +
    `</code></pre></div>` +
    `<div class="stats">${st}</div>`;
}

// a name only a debug build's ASSERT text gives (doc.attested): the expression verbatim,
// the file, the members it names (the about page explains why ASSERT text counts)
const attestedHtml = (doc, a, known) =>
  `<dl class="att"><dt>ASSERT</dt><dd><code>${esc(a.text)}</code></dd>` +
  `<dt>in</dt><dd>${esc(a.file)} ${tagHtml(doc, "names", null)}</dd>` +
  (a.members ? `<dt>members</dt><dd>${a.members.map(esc).join(", ")}</dd>` : "") +
  (known ? "" : `<dt>kind</dt><dd>unknown (struct, union or scalar)</dd>`) + `</dl>`;

// where else a name has a layout: this build's other modules by name, then per module
// its other builds as a range oldest → newest, the full list behind a disclosure. A
// build reads as its release name with the build number beside it (buildName).
function definedIn(doc, name, defs) {
  if (!defs.length) return "";
  const href = (d) => esc(`${typePath(d.arch, d.module, name)}#${d.build}`);
  const lab = (d) => d.buildLabel || d.build;
  const title = (d) => esc(`${d.family} · ${lab(d)} · ${d.module}`);
  const a = (d) => `<a href="${href(d)}" title="${title(d)}">${esc(buildName(d.family))}` +
    (d.buildLabel === "no build number" ? "" : ` <small>${esc(lab(d))}</small>`) + `</a>`;
  const here = defs.filter((d) => d.build === doc.build), other = defs.filter((d) => d.build !== doc.build);
  const mods = [...new Set(other.map((d) => d.module))].sort((x, y) => (y === doc.module) - (x === doc.module) || (x < y ? -1 : 1));
  const range = (m) => {
    const ds = other.filter((d) => d.module === m);  // newest first
    const lead = `Layout in ${m === doc.module ? "" : esc(m) + ": "}`;
    if (ds.length === 1) return `<div>${lead}${a(ds[0])}</div>`;
    return `<details><summary>${lead}${a(ds.at(-1))} → ${a(ds[0])} <span class="n">(${ds.length} builds)</span></summary>` +
      `<div class="di-list">${ds.map(a).join(" · ")}</div></details>`;
  };
  return `<div class="defined-in">` +
    (here.length ? `<div>Also in this build: ${here.map((d) =>
      `<a href="${href(d)}" title="${title(d)}">${esc(d.module)}</a>`).join(", ")}</div>` : "") +
    mods.map(range).join("") + `</div>`;
}

// an opaque name's view in one build: its declaration, and where it does have a layout
// (other modules of this build first, then other builds, newest first)
export function opaqueHtml(doc, name, kind) {
  const defs = catalog().docs
    .filter((d) => d.arch === doc.arch && name in d.named)
    .sort((x, y) => ((y.build === doc.build) - (x.build === doc.build)) || cmpBuild(y.build, x.build) ||
      (x.module < y.module ? -1 : 1));
  const att = doc.attested?.[name], known = kind !== "type";
  return `<pre class="sc-pre"><code><div class="sc-line"><span class="sc-code">${known ? `<span class="kw">${esc(kind)}</span> ` : ""}${esc(name)};</span>` +
    `<span class="sc-ann">/* ${att ? "named only" : "opaque"} */</span></div></code></pre>` +
    (att ? attestedHtml(doc, att, known)
    : `<p class="opaque-note">${doc.sources ? "Declared, not defined, in the sources this build's layouts come from."
      : "Declared, not defined, in the public PDB: a forward declaration or a name from a mangled symbol."}</p>`) +
    definedIn(doc, name, defs);
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
    view: st === "d" ? panelHtml(typesFor(doc), name, doc) : opaqueHtml(doc, name, page.kind),
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
