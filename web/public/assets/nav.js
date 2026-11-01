// Sidebar (per-context type list), ⌘K palette (every type in every build), the
// listing-page filter, and the home page's "last module viewed per build" links.
// Vanilla and loaded once: islands would inline Astro's hydration runtime into every
// one of ~28k pages. The sidebar <aside> is transition:persist, so its DOM (filter,
// scroll) survives ClientRouter navigations; we just re-sync on astro:page-load.
(() => {
  if (window.__vpNav) return;
  window.__vpNav = true;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dot = (k) => `<i class="dot k-${k}"></i>`;
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

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
    root.querySelectorAll(".btn[data-k]").forEach((b) => {
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
    store(`vp-mod:${sb.loc.arch}/${sb.loc.build}`, sb.loc.module);
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
    const b = e.target.closest?.("#vp-sb .btn[data-k]");
    if (b) { sb.kind = b.dataset.k; sbRender(); }
  });

  // ---- module listing page filter ---------------------------------------------
  const tl = { q: "", kind: "all" };
  const tlApply = () => {
    const v = tl.q.toLowerCase();
    document.querySelectorAll("[data-tl] a").forEach((a) => {
      a.hidden = !((tl.kind === "all" || a.classList.contains("k-" + tl.kind)) &&
                   (!v || a.textContent.toLowerCase().includes(v)));
    });
    document.querySelectorAll("[data-tl-ctrl] .btn[data-k]").forEach((b) => b.classList.toggle("on", b.dataset.k === tl.kind));
  };
  document.addEventListener("input", (e) => {
    if (e.target.matches(".tl-filter")) { tl.q = e.target.value; tlApply(); }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-tl-ctrl] .btn[data-k]");
    if (b) { tl.kind = b.dataset.k; tlApply(); }
  });

  // ---- home: jump into the module last viewed for each build, else the kernel ----
  const homeLinks = () => document.querySelectorAll("a.vrow[data-ab]").forEach((a) => {
    const last = store(`vp-mod:${a.dataset.ab}`);
    const mod = last && a.dataset.mods.split(",").includes(last) ? last : a.dataset.def;
    a.href = `/v/${a.dataset.ab}/${mod}.html`;
  });

  // ---- nav buttons ----------------------------------------------------------------
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-cmdk]")) ckOpen(!ck.open);
    else if (e.target.closest?.("[data-side-toggle]")) {
      const c = document.documentElement.classList.toggle("side-collapsed");
      store("vp-side", c ? "0" : "1");
    }
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

  const sync = () => {
    ck.open = false; ckRender(); sbSync(); homeLinks();
    tl.q = ""; tl.kind = "all";
    document.documentElement.classList.toggle("side-collapsed", store("vp-side") === "0");
  };
  document.addEventListener("astro:page-load", sync);
  if (document.readyState !== "loading") sync();
  else document.addEventListener("DOMContentLoaded", sync);
})();
