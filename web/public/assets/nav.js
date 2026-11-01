// Sidebar (per-context type list) + ⌘K palette (every type in every build).
// Vanilla and loaded once: islands would inline Astro's hydration runtime into every
// one of ~28k pages. The sidebar <aside> is transition:persist, so its DOM (filter,
// scroll) survives ClientRouter navigations; we just re-sync on astro:page-load.
(() => {
  if (window.__vpNav) return;
  window.__vpNav = true;
  const KDOT = { struct: "#bd93f9", union: "#ff79c6", enum: "#50fa7b" };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dot = (k) => `<i class="sb-dot" style="background:${KDOT[k] || "#6272a4"}"></i>`;

  // ---- sidebar -------------------------------------------------------------
  const sb = { items: [], ctx: "", q: "", kind: "all", loc: null };
  // /v/<arch>/<build>/<module>[/<slug>].html
  const parseLoc = () => {
    const m = location.pathname.match(/^\/v\/([^/]+)\/([^/]+)\/([^/.]+)(?:\/([^/]+))?\.html$/);
    return m && { arch: m[1], build: m[2], module: m[3], ctx: `/v/${m[1]}/${m[2]}/${m[3]}`,
                  slug: m[4] ? decodeURIComponent(m[4]) : null };
  };
  const sbRender = () => {
    const root = document.getElementById("vp-sb");
    if (!root || !sb.loc) return;
    const v = sb.q.toLowerCase();
    const shown = sb.items.filter((it) => (sb.kind === "all" || it.k === sb.kind) && (!v || it.n.toLowerCase().includes(v)));
    const c = { all: sb.items.length, struct: 0, union: 0, enum: 0 };
    for (const it of sb.items) c[it.k]++;
    root.querySelector(".sb-ctx").innerHTML =
      `<b>${esc(sb.loc.module)}</b> <span>${esc(sb.loc.arch)} · ${esc(sb.loc.build)}</span>`;
    root.querySelector(".sb-ctx").href = sb.loc.ctx + ".html";
    root.querySelectorAll(".sb-kind").forEach((b) => {
      b.classList.toggle("on", b.dataset.k === sb.kind);
      b.title = `${c[b.dataset.k] || 0} ${b.dataset.k}`;
    });
    root.querySelector(".sb-count").textContent = `${shown.length} types`;
    root.querySelector(".sb-list").innerHTML = shown.map((it) =>
      `<a class="sb-item${it.s === sb.loc.slug ? " active" : ""}" href="${sb.loc.ctx}/${esc(it.s)}.html">${dot(it.k)}${esc(it.n)}</a>`).join("");
    root.querySelector(".sb-item.active")?.scrollIntoView({ block: "nearest" });
  };
  const sbSync = () => {
    sb.loc = parseLoc();
    if (!sb.loc) return;
    if (sb.ctx !== sb.loc.ctx) {
      sb.ctx = sb.loc.ctx; sb.items = [];
      const want = sb.ctx;
      fetch(`/ti/${sb.loc.arch}/${sb.loc.build}/${sb.loc.module}.json`).then((r) => r.json())
        .then((items) => { if (sb.ctx === want) { sb.items = items; sbRender(); } }).catch(() => {});
    }
    sbRender();
  };
  document.addEventListener("input", (e) => {
    if (e.target.matches(".sb-filter")) { sb.q = e.target.value; sbRender(); }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".sb-kind[data-k]");
    if (b) { sb.kind = b.dataset.k; sbRender(); }
  });

  // ---- ⌘K palette ------------------------------------------------------------
  const ck = { open: false, items: null, hits: [], sel: 0, here: null };
  const href = (it) => `/v/${it.a}/${it.b}/${it.m}/${it.s}.html`;
  const el = () => document.getElementById("vp-ck");
  const ckRender = () => {
    const root = el();
    if (!root) return;
    root.hidden = !ck.open;
    if (!ck.open) return;
    const q = root.querySelector(".ck-input").value.toLowerCase().trim();
    let body;
    if (ck.items === null) body = `<div class="ck-empty">Loading index…</div>`;
    else if (!q) body = `<div class="ck-empty">${ck.items.length.toLocaleString()} types across every build — start typing</div>`;
    else {
      const h = ck.here;
      const out = [];
      for (const it of ck.items) {
        const n = it.n.toLowerCase(), i = n.indexOf(q);
        if (i < 0) continue;
        // lower is better: current context first, then prefix match, then position, then shorter name
        const inHere = h && it.a === h.a && it.b === h.b && it.m === h.m;
        out.push([(inHere ? 0 : 1e6) + (i === 0 ? 0 : 1e4) + i * 100 + n.length, it]);
      }
      out.sort((x, y) => x[0] - y[0]);
      ck.hits = out.slice(0, 60).map((x) => x[1]);
      ck.sel = Math.min(ck.sel, Math.max(0, ck.hits.length - 1));
      body = ck.hits.length ? ck.hits.map((it, i) =>
        `<a class="ck-item${i === ck.sel ? " sel" : ""}" data-i="${i}" href="${esc(href(it))}">${dot(it.k)}<span class="ck-name">${esc(it.n)}</span><span class="ck-kind">${esc(it.m)} · ${esc(it.a)} · ${esc(it.b)}</span></a>`).join("")
        : `<div class="ck-empty">No matches</div>`;
    }
    root.querySelector(".ck-list").innerHTML = body;
    root.querySelector(".ck-item.sel")?.scrollIntoView({ block: "nearest" });
  };
  const ckOpen = (open) => {
    ck.open = open;
    const root = el();
    if (!root) return;
    if (open) {
      const m = location.pathname.match(/^\/v\/([^/]+)\/([^/]+)\/([^/.]+)/);
      ck.here = m && { a: m[1], b: m[2], m: m[3] };
      ck.sel = 0;
      root.querySelector(".ck-input").value = "";
      if (!ck.items) fetch("/search-index.json").then((r) => r.json())
        .then((x) => { ck.items = x; ckRender(); }).catch(() => { ck.items = []; ckRender(); });
      setTimeout(() => root.querySelector(".ck-input").focus(), 0);
    }
    ckRender();
  };
  window.vpCmdK = () => ckOpen(!ck.open);
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ckOpen(!ck.open); return; }
    if (!ck.open) return;
    if (e.key === "Escape") ckOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); ck.sel = Math.min(ck.sel + 1, ck.hits.length - 1); ckRender(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); ck.sel = Math.max(ck.sel - 1, 0); ckRender(); }
    else if (e.key === "Enter" && ck.hits[ck.sel]) { e.preventDefault(); location.href = href(ck.hits[ck.sel]); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.matches(".ck-input")) { ck.sel = 0; ckRender(); }
  });
  document.addEventListener("click", (e) => {
    if (e.target.id === "vp-ck") ckOpen(false);  // backdrop
  });
  document.addEventListener("mouseover", (e) => {
    const it = e.target.closest?.(".ck-item[data-i]");
    if (it && +it.dataset.i !== ck.sel) {
      el().querySelector(".ck-item.sel")?.classList.remove("sel");
      it.classList.add("sel"); ck.sel = +it.dataset.i;
    }
  });

  const sync = () => { ck.open = false; ckRender(); sbSync(); };
  document.addEventListener("astro:page-load", sync);
  if (document.readyState !== "loading") sync();
  else document.addEventListener("DOMContentLoaded", sync);
})();
