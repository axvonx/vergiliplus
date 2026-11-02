// Sidebar (per-context type list), the search palette (every type in every build),
// the listing-page filter, and the home page's "last module viewed per build" links.
// Vanilla and loaded once: islands would inline Astro's hydration runtime into every
// one of ~30k pages. The sidebar <aside> is transition:persist, so its DOM (filter,
// scroll) survives ClientRouter navigations; we just re-sync on astro:page-load.
(() => {
  if (window.__vpNav) return;
  window.__vpNav = true;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dot = (k) => `<i class="dot k-${k}"></i>`;
  // scroll el into view within its own list only (scrollIntoView would also scroll the
  // window, hiding the top nav on every type page)
  const nearest = (list, el) => {
    if (!list || !el) return;
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + el.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = top + el.offsetHeight - list.clientHeight;
  };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  // a kind filter: "all", "opaque", or a kind among *documented* types
  const kindOk = (kind, k, opaque) => kind === "all" || (kind === "opaque" ? opaque : !opaque && k === kind);

  // ---- sidebar -------------------------------------------------------------
  const sb = { items: [], ctx: "", q: "", kind: "all", loc: null };
  // a listing, /v/<arch>/<build>/<module>.html, or a type page,
  // /t/<arch>/<module>/<slug>.html whose build is the one struct.js shows (#<build>)
  const tpage = () => document.querySelector("[data-tp]");
  const parseLoc = () => {
    let m = location.pathname.match(/^\/v\/([^/]+)\/([^/]+)\/([^/.]+)\.html$/);
    if (m) return { arch: m[1], build: m[2], module: m[3], ctx: `/v/${m[1]}/${m[2]}/${m[3]}`, slug: null };
    m = location.pathname.match(/^\/t\/([^/]+)\/([^/]+)\/([^/]+)\.html$/);
    const tp = tpage();
    return m && tp && { arch: m[1], build: tp.dataset.cur, module: m[2], ctx: `/v/${m[1]}/${tp.dataset.cur}/${m[2]}`,
                        slug: decodeURIComponent(m[3]) };
  };
  // ?m=<member> asks struct.js to highlight that member (the palette's member filter)
  const typeUrl = (arch, module, s, build, mem) =>
    `/t/${arch}/${module}/${s}.html${mem ? "?m=" + encodeURIComponent(mem) : ""}#${encodeURIComponent(build)}`;
  const sbRender = () => {
    const root = document.getElementById("vp-sb");
    if (!root || !sb.loc) return;
    const v = sb.q.toLowerCase();
    const shown = sb.items.filter((it) => kindOk(sb.kind, it.k, it.o) && (!v || it.n.toLowerCase().includes(v)));
    const c = { all: sb.items.length, struct: 0, union: 0, enum: 0, opaque: 0 };
    for (const it of sb.items) it.o ? c.opaque++ : c[it.k]++;
    root.querySelectorAll(".btn[data-k]").forEach((b) => {
      b.classList.toggle("on", b.dataset.k === sb.kind);
      b.title = `${c[b.dataset.k] || 0} ${b.dataset.k}`;
    });
    root.querySelector(".sb-count").textContent = `${shown.length} types`;
    root.querySelector(".sb-list").innerHTML = shown.map((it) =>
      `<a class="sb-item${it.s === sb.loc.slug ? " active" : ""}${it.o ? " op" : ""}" href="${esc(typeUrl(sb.loc.arch, sb.loc.module, it.s, sb.loc.build))}">${dot(it.k)}${esc(it.n)}</a>`).join("");
    nearest(root.querySelector(".sb-list"), root.querySelector(".sb-item.active"));
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
      const k = (a.className.match(/\bk-(\w+)/) || [])[1];
      a.hidden = !(kindOk(tl.kind, k, a.classList.contains("op")) && (!v || a.textContent.toLowerCase().includes(v)));
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

  // ---- context bar build switcher: same type in the chosen build, else its listing ----
  // The page ships only its own build's <option>; the rest come from /builds.json.
  // On a type page this also re-syncs the steps and module links to the shown build.
  let builds = null;
  const barSync = () => {
    const s = document.querySelector(".cb-build[data-am]");
    if (!s) return;
    const tp = tpage(), cur = tp ? tp.dataset.cur : s.dataset.cur || s.value;
    s.dataset.cur = cur;
    document.querySelectorAll(".cb-mod[data-tpage]").forEach((a) => {
      a.href = a.getAttribute("href").split("#")[0] + "#" + encodeURIComponent(cur);
    });
    (builds ||= fetch("/builds.json").then((r) => r.ok ? r.json() : Promise.reject(r.status)))
      .then((all) => {
        const list = all[s.dataset.am], has = s.dataset.has;
        if (!list) return;
        const mark = (i) => (has ? has[i] : "d");
        s.innerHTML = list.map(([b, fam], i) => {
          const st = mark(i);
          return `<option value="${esc(b)}"${b === cur ? " selected" : ""}${st === "-" ? ' data-n="1"' : ""}>` +
            `${esc(fam)} — ${esc(b)}${st === "-" ? "  (not defined)" : st === "o" ? "  (opaque)" : ""}</option>`;
        }).join("");
        const step = document.querySelector("[data-step]");
        if (!step || !has) return;
        const tb = list.filter((_, i) => mark(i) !== "-"), i = tb.findIndex(([b]) => b === cur);
        const link = (x, txt) => `<a href="#${esc(encodeURIComponent(x[0]))}" title="${esc(x[1])} ${esc(x[0])}">${esc(txt)}</a>`;
        step.innerHTML = (i > 0 ? link(tb[i - 1], `← ${tb[i - 1][0]}`) : `<span class="off">← first</span>`) +
          `<span class="n">${tb.length} build${tb.length === 1 ? "" : "s"}</span>` +
          (i >= 0 && i < tb.length - 1 ? link(tb[i + 1], `${tb[i + 1][0]} →`) : `<span class="off">latest →</span>`);
      })
      .catch(() => { builds = null; });  // keep what the page shipped; retry next time
  };
  document.addEventListener("change", (e) => {
    const s = e.target;
    if (!s.matches?.(".cb-build")) return;
    const absent = s.selectedOptions[0].dataset.n;
    if (s.dataset.tsel && !absent) location.hash = encodeURIComponent(s.value);
    else location.href = s.dataset.l.replace("@", s.value);
  });
  document.addEventListener("vp:build", () => { barSync(); sbSync(); });

  // ---- search palette ----------------------------------------------------------
  // Index (/search-index.json): v = [[arch, build, family, channel]] newest first,
  // m = [module], t = [[name, kind, slug, module#, [defined in v#], [opaque in v#]]].
  // One row per type x module; a presence strip shows every selected version.
  const ck = { open: false, ix: null, loading: null, err: false, mx: null, mxLoading: null, hits: [], sel: 0, here: null };
  // filters, remembered: kind, modules switched off, versions switched off, opaque
  // shown, and mem: match member/enumerator names (/member-index.json, f = [[name,
  // [t#]]]) instead of type names
  const F = (() => { try { return JSON.parse(store("vp-ck")) || {}; } catch (e) { return {}; } })();
  F.kind ||= "all"; F.mOff ||= []; F.vOff ||= []; F.op ??= true;
  const saveF = () => store("vp-ck", JSON.stringify(F));
  const el = () => document.getElementById("vp-ck");
  // created on first open, not shipped in every page (ClientRouter swaps <body>, so
  // it is re-created after a navigation if opened again)
  const PALETTE = `<div id="vp-ck" class="ck-ov" hidden><div class="ck">` +
    `<input class="ck-input" placeholder="Search every type in every build…">` +
    `<div class="ck-filters"></div><div class="ck-list"></div>` +
    `<div class="ck-foot">↑↓ move · ↵ open · click a square for that build · esc close · / or ⌘K to open</div></div></div>`;
  const short = (fam) => fam.replace(/^Windows /, "");
  // once there is more than one architecture a build is named "<build> · <arch>"
  const arched = () => new Set(ck.ix.v.map((v) => v[0])).size > 1;
  const vname = (v) => (arched() ? `${v[1]} · ${v[0]}` : v[1]);
  // per-version on/off, recomputed only when F.vOff is replaced (it is never mutated)
  let onFor = null, on = [];
  const vOn = (i) => {
    if (onFor !== F.vOff) { onFor = F.vOff; const off = new Set(F.vOff); on = ck.ix.v.map((v) => !off.has(v[0] + "/" + v[1])); }
    return on[i];
  };
  const typeHref = (t, vi, f) => { const v = ck.ix.v[vi]; return typeUrl(v[0], ck.ix.m[t[3]], t[2], v[1], f); };
  const loadMembers = () => {
    if (ck.mx || ck.mxLoading) return;
    ck.mxLoading = fetch("/member-index.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((x) => { ck.mx = x; }).catch(() => {}).finally(() => { ck.mxLoading = null; ckRender(); });
  };

  // where a row goes: this page's build if the type is there, else the newest selected
  // version defining it, else the newest selected version where it's opaque
  const target = (t) => {
    const h = ck.here;
    const here = h && ck.ix.v.findIndex((v) => v[0] === h.a && v[1] === h.b);
    if (here >= 0 && (t[4].includes(here) || t[5].includes(here))) return here;
    return t[4].find(vOn) ?? (F.op ? t[5].find(vOn) : undefined) ?? t[4][0] ?? t[5][0];
  };

  const renderFilters = () => {
    const root = el(), ix = ck.ix;
    const kinds = ["all", "struct", "union", "enum"];
    const nOn = ix.v.filter((_, i) => vOn(i)).length;
    root.querySelector(".ck-filters").innerHTML =
      `<span class="ck-grp">${kinds.map((k) => `<button class="btn kind-btn${F.kind === k ? " on" : ""}" data-ck-k="${k}">${k}</button>`).join("")}</span>` +
      `<span class="ck-grp" title="PDB">${ix.m.map((m) => `<button class="btn${F.mOff.includes(m) ? "" : " on"}" data-ck-m="${esc(m)}">${esc(m)}.pdb</button>`).join("")}</span>` +
      `<button class="btn${F.op ? " on" : ""}" data-ck-op title="include names a PDB declares but doesn't define">opaque</button>` +
      `<button class="btn${F.mem ? " on" : ""}" data-ck-mem title="search struct members and enum values instead of type names">members</button>` +
      `<span class="ck-vers"><button class="btn${nOn < ix.v.length ? " on" : ""}" data-ck-vers>Versions ${nOn}/${ix.v.length} ▾</button>` +
      `<span class="ck-vmenu" hidden><span class="ck-vall"><button class="btn" data-ck-vall="1">all</button><button class="btn" data-ck-vall="0">none</button></span>` +
      ix.v.map((v, i) => `<label class="ch-${v[3]}"><input type="checkbox" data-ck-v="${i}"${vOn(i) ? " checked" : ""}>` +
        `<span class="vf">${esc(v[2])}</span><span class="vb">${esc(vname(v))}</span></label>`).join("") + `</span></span>`;
  };

  const ckRender = () => {
    const root = el();
    if (!root) return;
    root.hidden = !ck.open;
    if (!ck.open) return;
    const ix = ck.ix, list = root.querySelector(".ck-list");
    if (!ix) { list.innerHTML = `<div class="ck-empty">${ck.err ? "Couldn't load the search index" : "Loading index…"}</div>`; return; }
    const raw = root.querySelector(".ck-input").value.toLowerCase().trim();
    const terms = raw.split(/\s+/).filter(Boolean);
    if (!terms.length) {
      list.innerHTML = `<div class="ck-empty">${ix.t.length.toLocaleString()} types across ${ix.v.length} builds. Type to search; several words narrow it down.</div>`;
      ck.hits = []; return;
    }
    const h = ck.here, hm = h && ix.m.indexOf(h.m);
    // score a name against every term (lower is better), or -1 if a term is missing
    const scoreOf = (name) => {
      const n = name.toLowerCase(), bare = n.replace(/^_+/, "");
      let score = 0;
      for (const q of terms) {
        const i = n.indexOf(q);
        if (i < 0) return -1;
        score += (n === q || bare === q ? 0 : bare.startsWith(q) || i === 0 ? 1e3 : 1e4 + i * 10);
      }
      return score + n.length;
    };
    const rowOk = (t) => (F.kind === "all" || t[1] === F.kind) && !F.mOff.includes(ix.m[t[3]]) &&
      (t[4].some(vOn) || (F.op && t[5].some(vOn)));
    // documented beats opaque-only, this page's module first
    const rowScore = (t) => (t[4].length ? 0 : 5e4) + (t[3] === hm ? 0 : 500);
    const out = [];  // [score, [t, member | null]]
    if (F.mem) {
      if (!ck.mx) { loadMembers(); list.innerHTML = `<div class="ck-empty">Loading member index…</div>`; ck.hits = []; return; }
      for (const [f, rows] of ck.mx.f) {
        const sc = scoreOf(f);
        if (sc < 0) continue;
        for (const ti of rows) { const t = ix.t[ti]; if (rowOk(t)) out.push([sc + rowScore(t) + t[0].length / 100, [t, f]]); }
      }
    } else {
      for (const t of ix.t) {
        if (!rowOk(t)) continue;
        const sc = scoreOf(t[0]);
        if (sc >= 0) out.push([sc + rowScore(t), [t, null]]);
      }
    }
    out.sort((a, b) => a[0] - b[0]);
    ck.hits = out.slice(0, 80).map((x) => x[1]);
    ck.sel = Math.min(ck.sel, Math.max(0, ck.hits.length - 1));
    const q0 = terms[0];
    const mark = (name) => {
      const i = name.toLowerCase().indexOf(q0);
      return i < 0 ? esc(name) : esc(name.slice(0, i)) + `<b>${esc(name.slice(i, i + q0.length))}</b>` + esc(name.slice(i + q0.length));
    };
    // oldest -> newest strip over the selected versions: filled = defined, ring = opaque
    const order = ix.v.map((_, i) => i).filter(vOn).reverse();
    list.innerHTML = ck.hits.length ? ck.hits.map(([t, f], i) => {
      const ti = target(t), tv = ix.v[ti];
      const strip = order.map((vi) => {
        const st = t[4].includes(vi) ? "d" : t[5].includes(vi) ? "o" : "";
        const v = ix.v[vi];
        return `<i class="ch-${v[3]}${st ? " " + st : ""}"${st ? ` data-go="${esc(typeHref(t, vi, f))}"` : ""} title="${esc(v[2])} ${esc(vname(v))}${st === "o" ? " (opaque)" : st ? "" : " (absent)"}"></i>`;
      }).join("");
      return `<a class="ck-item${i === ck.sel ? " sel" : ""}${t[4].length ? "" : " op"}" data-i="${i}" href="${esc(typeHref(t, ti, f))}">` +
        `${dot(t[1])}<span class="ck-name">${f ? `${esc(t[0])}<span class="ck-fld">.${mark(f)}</span>` : mark(t[0])}</span><span class="ck-mod">${esc(ix.m[t[3]])}</span>` +
        `<span class="ck-strip">${strip}</span><span class="ck-ver ch-${tv[3]}">${esc(short(tv[2]))}${arched() ? " " + esc(tv[0]) : ""}</span></a>`;
    }).join("") : `<div class="ck-empty">No matches with these filters</div>`;
    nearest(list, list.querySelector(".ck-item.sel"));
  };

  const ckOpen = (open) => {
    ck.open = open;
    if (open && !el()) document.body.insertAdjacentHTML("beforeend", PALETTE);
    const root = el();
    if (!root) return;
    if (open) {
      const l = parseLoc();
      ck.here = l && { a: l.arch, b: l.build, m: l.module };
      ck.sel = 0;
      root.querySelector(".ck-input").value = "";
      if (!ck.ix && !ck.loading) {
        ck.err = false;
        ck.loading = fetch("/search-index.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then((x) => { ck.ix = x; renderFilters(); })
          .catch(() => { ck.err = true; })
          .finally(() => { ck.loading = null; ckRender(); });
      } else if (ck.ix) renderFilters();
      setTimeout(() => root.querySelector(".ck-input").focus(), 0);
    }
    ckRender();
  };
  document.addEventListener("keydown", (e) => {
    const a = document.activeElement;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(a?.tagName) || a?.isContentEditable;
    const slash = e.key === "/" && !typing && !ck.open && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || slash) {
      e.preventDefault(); ckOpen(!ck.open); return;
    }
    if (!ck.open) return;
    if (e.key === "Escape") ckOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); ck.sel = Math.min(ck.sel + 1, ck.hits.length - 1); ckRender(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); ck.sel = Math.max(ck.sel - 1, 0); ckRender(); }
    else if (e.key === "Enter" && ck.hits[ck.sel]) {
      e.preventDefault();
      const [t, f] = ck.hits[ck.sel];
      location.href = typeHref(t, target(t), f);
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.matches(".ck-input")) { ck.sel = 0; ckRender(); }
  });
  document.addEventListener("change", (e) => {
    const c = e.target.closest?.("[data-ck-v]");
    if (!c) return;
    const v = ck.ix.v[+c.dataset.ckV], key = v[0] + "/" + v[1];
    F.vOff = c.checked ? F.vOff.filter((x) => x !== key) : [...F.vOff, key];
    saveF();
    el().querySelector("[data-ck-vers]").textContent = `Versions ${ck.ix.v.filter((_, i) => vOn(i)).length}/${ck.ix.v.length} ▾`;
    ckRender();
  });
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.id === "vp-ck") { ckOpen(false); return; }  // backdrop
    if (!t.closest?.("#vp-ck")) {
      if (t.closest?.("[data-cmdk]")) ckOpen(!ck.open);
      return;
    }
    const go = t.closest("[data-go]");
    if (go) {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(go.dataset.go, "_blank");
      else location.href = go.dataset.go;
      return;
    }
    const menu = el().querySelector(".ck-vmenu");
    if (t.closest("[data-ck-vers]")) { menu.hidden = !menu.hidden; return; }
    if (menu && !menu.hidden && !t.closest(".ck-vmenu")) menu.hidden = true;
    let b;
    if ((b = t.closest("[data-ck-k]"))) F.kind = b.dataset.ckK;
    else if ((b = t.closest("[data-ck-m]"))) {
      const m = b.dataset.ckM;
      F.mOff = F.mOff.includes(m) ? F.mOff.filter((x) => x !== m) : [...F.mOff, m];
    } else if ((b = t.closest("[data-ck-op]"))) F.op = !F.op;
    else if ((b = t.closest("[data-ck-mem]"))) F.mem = !F.mem;
    else if ((b = t.closest("[data-ck-vall]"))) F.vOff = b.dataset.ckVall === "1" ? [] : ck.ix.v.map((v) => v[0] + "/" + v[1]);
    else return;
    saveF();
    const open = !menu.hidden;
    renderFilters();
    if (open) el().querySelector(".ck-vmenu").hidden = false;
    ckRender();
  });
  document.addEventListener("mouseover", (e) => {
    const it = e.target.closest?.(".ck-item[data-i]");
    if (it && +it.dataset.i !== ck.sel) {
      el().querySelector(".ck-item.sel")?.classList.remove("sel");
      it.classList.add("sel"); ck.sel = +it.dataset.i;
    }
  });

  // ---- nav buttons ----------------------------------------------------------------
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-side-toggle]")) {
      const c = document.documentElement.classList.toggle("side-collapsed");
      store("vp-side", c ? "0" : "1");
    }
  });

  const sync = () => {
    ck.open = false; ckRender(); sbSync(); homeLinks(); barSync();
    tl.q = ""; tl.kind = "all";
    document.documentElement.classList.toggle("side-collapsed", store("vp-side") === "0");
  };
  document.addEventListener("astro:page-load", sync);
  if (document.readyState !== "loading") sync();
  else document.addEventListener("DOMContentLoaded", sync);
})();
