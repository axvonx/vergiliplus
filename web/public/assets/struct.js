// Type pages: the #<build> router (views from the type's pack, see lib/panel.mjs), the
// struct view's Metadata toggle (remembered), copy, row click-through, and the tabs
// under the view (Used in · Changes · History; the last two drawn by diff.js). Document-
// level delegation, so it survives ClientRouter swaps.
(() => {
  if (window.__vpStruct) return;
  window.__vpStruct = true;
  const KEY = "vp-meta";
  const metaOn = () => { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
  const apply = () => document.querySelectorAll("[data-sc]").forEach((sc) => {
    const on = metaOn();
    sc.classList.toggle("meta-off", !on);
    sc.querySelector("[data-sc-meta]")?.setAttribute("aria-pressed", String(on));
  });

  // the visible view as plain C (padding/cacheline lines + annotations only with Metadata)
  const text = (sc) => {
    const meta = !sc.classList.contains("meta-off");
    const out = [];
    for (const l of sc.querySelectorAll(".sc-line, .sc-member")) {
      if (!meta && l.matches(".sc-hole, .sc-cache")) continue;
      const code = l.querySelector(".sc-code")?.textContent ?? "";
      const ann = meta && l.querySelector(".sc-ann")?.textContent;
      if (l.matches(".sc-cache")) out.push("");
      out.push(ann ? code + " ".repeat(Math.max(2, 60 - code.length)) + ann : code);
    }
    return out.join("\n");
  };

  document.addEventListener("click", (e) => {
    const t = e.target;
    const sc = t.closest?.("[data-sc]");
    if (!sc) return;
    if (t.closest("[data-sc-meta]")) {
      try { localStorage.setItem(KEY, metaOn() ? "0" : "1"); } catch (err) {}
      apply();
    } else if (t.closest("[data-sc-copy]")) {
      const b = t.closest("[data-sc-copy]");
      navigator.clipboard?.writeText(text(sc));
      b.textContent = "copied ✓";
      setTimeout(() => { b.textContent = "copy"; }, 1200);
    } else {
      // whole-row click follows the row's type link
      const a = t.closest(".sc-member.link")?.querySelector("a.str-link");
      if (a && !t.closest("a") && !getSelection().toString()) a.click();
    }
  });
  // a type the sources define in more than one way: the select shows one definition
  document.addEventListener("change", (e) => {
    const sel = e.target.closest?.("[data-var-sel]");
    if (!sel) return;
    sel.closest("[data-vars]").querySelectorAll("[data-var]").forEach((v) => {
      v.hidden = v.dataset.var !== sel.value;
    });
  });
  // ---- type pages: #<build> picks the build (default: data-def, inlined) ----------
  // Other builds' views come from the type's pack, {n: [build], v: [view html],
  // u: [[used-in names]], b: [[v#, u#] | 0 per n]}, gzipped (lib/panel.mjs packOf).
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const slugOf = (s) => s.replace(/[^A-Za-z0-9_.-]/g, "_");  // = types.mjs slug
  const packs = new Map();
  const inflate = async (r) => {
    const buf = new Uint8Array(await r.arrayBuffer());
    // gzip starts 1f 8b; a host that set Content-Encoding has already decoded it
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf));
    return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).json();
  };
  const pack = (u) => {
    if (!packs.has(u)) packs.set(u, fetch(u).then((r) => (r.ok ? inflate(r) : Promise.reject(r.status)))
      .catch((e) => { packs.delete(u); throw e; }));
    return packs.get(u);
  };
  // type links (code rows, used-in) carry the build being viewed; "defined in" links
  // already name theirs
  const tag = (tp) => tp.querySelectorAll("[data-view] a.str-link, [data-used] a, [data-pane=diff] a.str-link").forEach((a) => {
    a.href = a.getAttribute("href").split("#")[0] + "#" + encodeURIComponent(tp.dataset.cur);
  });
  // ?m=<member> (from the palette's member filter): mark that row, once per URL
  let hitFor = "";
  const hit = (tp) => {
    const m = new URLSearchParams(location.search).get("m");
    if (!m || hitFor === location.href) return;
    hitFor = location.href;
    const row = [...tp.querySelectorAll("[data-view] .sc-member")].find((r) =>
      (r.querySelector(".sc-field")?.textContent ?? r.querySelector(".sc-code").textContent.trim().split(" ")[0]) === m);
    if (!row) return;
    row.classList.add("hit");
    window.scrollTo({ top: Math.max(0, scrollY + row.getBoundingClientRect().top - innerHeight / 3) });
  };
  const shown = (tp) => {
    tag(tp); apply(); hit(tp); tabs(tp);
    const name = document.querySelector(".cb-type")?.textContent;
    const mod = tp.dataset.pack.split("/")[3];
    if (name) document.title = `${name} · ${mod} ${tp.dataset.cur} · vergiliplus`;
    document.dispatchEvent(new CustomEvent("vp:build"));
  };
  const render = (tp, b, p) => {
    const i = p.n.indexOf(b), e = i >= 0 && p.b[i];
    const view = tp.querySelector("[data-view]");
    tp.dataset.cur = b;
    delete tp.dataset.base;  // Changes compares against the previous build again
    if (!e) view.innerHTML = `<p class="opaque-note">Not in this module for ${esc(b)}.</p>`;
    else view.innerHTML = p.v[e[0]];
    const u = e ? p.u[e[1]] : [];
    tp.querySelector("[data-used-n]").textContent = u.length;
    tp.querySelector("[data-used] .used-list").innerHTML = u.map((x) => `<a href="${esc(slugOf(x))}.html">${esc(x)}</a>`).join("");
    shown(tp);
  };
  // ---- tabs under the view: Used in · Changes · History (diff.js) ----------------
  // The chosen tab is remembered (vp-tab). Changes compares the shown build with the
  // previous one that has a layout (data-has "d"), or the one picked in its select.
  const TAB = "vp-tab";
  const tabNow = () => { try { return localStorage.getItem(TAB) || "used"; } catch (e) { return "used"; } };
  let labels = null;  // /builds.json (shared with nav.js's build popover; cached by the browser)
  const buildRows = (tp) => (labels ||= fetch("/builds.json").then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .catch((e) => { labels = null; throw e; }))
    .then((all) => { const [, , a, m] = tp.dataset.pack.split("/"); return new Map((all[`${a}/${m}`] || []).map((r) => [r[0], r])); });
  // a build as the tabs name it: its label, the release for an undated pre-release
  const short = (row, b) => !row ? b : row[4] === "no build number" ? row[3] : (row[4] || b).replace(/^10\.0\./, "");
  const full = (row, b) => (row ? `${row[4] || b} · ${row[1]}` : b);
  const typeName = () => document.querySelector(".cb-type")?.textContent || "";
  const tabs = (tp) => {
    const box = tp.querySelector("[data-tabs]");
    if (!box) return;
    if (!box.querySelector("[data-tab=diff]")) {
      box.querySelector(".tab-bar").setAttribute("role", "tablist");
      box.querySelector(".tab-bar").insertAdjacentHTML("beforeend",
        `<button type="button" class="tab" data-tab="diff">Changes</button><button type="button" class="tab" data-tab="hist">History</button>`);
      box.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("role", "tab"));
      box.querySelector("[data-used]").insertAdjacentHTML("beforeend",
        `<p class="opaque-note" data-used-none hidden>Not used by another type in this build.</p>`);
      box.insertAdjacentHTML("beforeend", `<div data-pane="diff" hidden></div><div data-pane="hist" hidden></div>`);
    }
    box.hidden = false;
    const u = +tp.querySelector("[data-used-n]").textContent;
    tp.querySelector("[data-used-none]").hidden = u > 0;
    const want = tabNow();
    box.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === want)));
    box.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== want; });
    if (want === "diff") changes(tp);
    else if (want === "hist") history(tp);
  };
  // diff.js (window.vpDiff), loaded the first time a Changes or History tab shows
  let lib = null;
  const diffLib = () => (lib ||= window.vpDiff ? Promise.resolve(window.vpDiff) : new Promise((ok, no) => {
    const s = Object.assign(document.createElement("script"), { src: "/assets/diff.js" });
    s.onload = () => ok(window.vpDiff);
    s.onerror = () => { lib = null; no(new Error("diff.js")); };
    document.head.append(s);
  }));
  const paneMsg = (pane, msg) => { pane.innerHTML = `<p class="opaque-note">${msg}</p>`; };
  const changes = (tp) => {
    const pane = tp.querySelector("[data-pane=diff]"), cur = tp.dataset.cur, has = tp.dataset.has;
    Promise.all([pack(tp.dataset.pack), buildRows(tp).catch(() => new Map()), diffLib()]).then(([p, rows, V]) => {
      if (tp.dataset.cur !== cur || !tp.isConnected) return;
      const i = p.n.indexOf(cur), name = esc(typeName());
      if (has[i] !== "d") return paneMsg(pane, `No layout for ${name} in this build to compare.`);
      const earlier = p.n.slice(0, i).filter((b, j) => has[j] === "d").reverse();
      if (!earlier.length) return paneMsg(pane, `${esc(short(rows.get(cur), cur))} is the first build with a layout for ${name}: nothing earlier to compare.`);
      const base = earlier.includes(tp.dataset.base) ? tp.dataset.base : earlier[0];
      const A = V.parse(p.v[p.b[p.n.indexOf(base)][0]]), B = V.parse(p.v[p.b[i][0]]);
      const sel = `<select class="df-base" data-df-base aria-label="Compare with">${earlier.map((b) =>
        `<option value="${esc(b)}"${b === base ? " selected" : ""}>${esc(full(rows.get(b), b))}</option>`).join("")}</select>`;
      const head = `<div class="df-head"><span class="df-since">since ${sel}</span>`;
      if (A.variants || B.variants)
        return void (pane.innerHTML = `${head}</div><p class="opaque-note">${esc(A.variants ? base : cur)}'s sources define ${name} in more than one way; Changes compares single definitions only.</p>`);
      const D = V.diff(A, B), c = D.count;
      const none = !(c.add + c.del + c.type + c.grew + c.shift);
      const L = none ? null : V.listing(D, `${B.kind || "struct"} ${typeName()} {`);
      pane.innerHTML = `${head}<span class="df-sum">${V.summary(D)}</span></div>` +
        (D.runs.length ? `<ul class="df-runs">${V.runsHtml(D)}</ul>` : "") +
        (none ? `<p class="opaque-note">Same layout as ${esc(short(rows.get(base), base))}.</p>`
          : `<div class="sc df"><pre class="sc-pre"><code><div class="sc-ctrls"><button class="sc-copy" data-df-copy>copy</button></div>` +
            `<div class="sc-line sc-head"><span class="df-mk"> </span><span class="sc-code"><span class="kw">${esc(B.kind || "struct")}</span> ${name} {</span></div>${L.html}` +
            `<div class="sc-line"><span class="df-mk"> </span><span class="sc-code">};</span></div></code></pre></div>`);
      pane._text = L?.text || "";
      tag(tp);
    }).catch(() => paneMsg(pane, "Couldn't load this type's other builds."));
  };
  const history = (tp) => {
    const pane = tp.querySelector("[data-pane=hist]"), cur = tp.dataset.cur, has = tp.dataset.has;
    const all = tp.dataset.hsAll === "1";
    Promise.all([pack(tp.dataset.pack), buildRows(tp).catch(() => new Map()), diffLib()]).then(([p, rows, V]) => {
      if (tp.dataset.cur !== cur || !tp.isConnected) return;
      const views = p.n.map((b, j) => has[j] === "-" || !p.b[j] ? null
        : { build: b, label: short(rows.get(b), b), title: full(rows.get(b), b), st: has[j], view: p.v[p.b[j][0]] }).filter(Boolean);
      const H = V.history(views, cur, all);
      const btn = H.shown === H.total && !all ? "" : `<button type="button" class="btn" data-hs-all>${all ? `only ${H.unit}s that appear or vanish` : `all ${H.total} ${H.unit}s`}</button>`;
      pane.innerHTML = `<div class="df-head"><span class="df-since">${views.length} builds · ${all ? `${H.total} ${H.unit}s`
        : `${H.shown} of ${H.total} ${H.unit}s, those that appear or vanish`}</span>${btn}</div>` +
        (H.empty ? `<p class="opaque-note">No ${H.unit} appears or vanishes across these builds.</p>` : H.html) +
        `<div class="hs-key"><span class="n">first appears</span><span class="m">offset changed</span><span class="p">same offset</span><span class="x">gone</span><span class="op">no layout</span></div>`;
    }).catch(() => paneMsg(pane, "Couldn't load this type's other builds."));
  };
  document.addEventListener("click", (e) => {
    const t = e.target, tp = t.closest?.("[data-tp]");
    if (!tp) return;
    const tab = t.closest("[data-tab]");
    if (tab) {
      try { localStorage.setItem(TAB, tab.dataset.tab); } catch (err) {}
      return tabs(tp);
    }
    const more = t.closest("[data-df-open]");
    if (more) { more.nextElementSibling.hidden = false; more.remove(); return; }
    const cp = t.closest("[data-df-copy]");
    if (cp) {
      navigator.clipboard?.writeText(tp.querySelector("[data-pane=diff]")._text || "");
      cp.textContent = "copied ✓";
      setTimeout(() => { cp.textContent = "copy"; }, 1200);
      return;
    }
    if (t.closest("[data-hs-all]")) { tp.dataset.hsAll = tp.dataset.hsAll === "1" ? "0" : "1"; history(tp); }
  });
  document.addEventListener("keydown", (e) => {
    const more = e.key === "Enter" && e.target.closest?.("[data-df-open]");
    if (more) { more.nextElementSibling.hidden = false; more.remove(); }
  });
  document.addEventListener("change", (e) => {
    const sel = e.target.closest?.("[data-df-base]"), tp = sel?.closest("[data-tp]");
    if (tp) { tp.dataset.base = sel.value; changes(tp); }
  });

  const route = () => {
    const tp = document.querySelector("[data-tp]");
    if (!tp) return apply();
    const want = decodeURIComponent(location.hash.slice(1)) || tp.dataset.def;
    if (want === tp.dataset.cur) return shown(tp);
    if (tp.dataset.want === want) return;  // already on its way (page-load + DOMContentLoaded)
    tp.dataset.want = want;
    pack(tp.dataset.pack).then((p) => { if (tp.dataset.want === want && tp.isConnected) render(tp, want, p); })
      .catch(() => {
        delete tp.dataset.want;
        tp.querySelector("[data-view]").insertAdjacentHTML("afterbegin",
          `<p class="opaque-note">Couldn't load ${esc(want)}; showing ${esc(tp.dataset.cur)}.</p>`);
      });
  };
  document.addEventListener("astro:page-load", route);
  window.addEventListener("hashchange", route);
  window.addEventListener("popstate", () => setTimeout(route, 0));
  if (document.readyState !== "loading") route();
  else document.addEventListener("DOMContentLoaded", route);
})();
