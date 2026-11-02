// Type pages: the #<build> router (views from the type's pack, see lib/panel.mjs), and
// the struct view's Metadata toggle (remembered), copy, row click-through. Document-
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
      if (!meta && l.matches(".sc-hole:not(.sc-unk), .sc-cache")) continue;
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
  const tag = (tp) => tp.querySelectorAll("[data-view] a.str-link, [data-used] a").forEach((a) => {
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
    tag(tp); apply(); hit(tp);
    const name = document.querySelector(".cb-type")?.textContent;
    const mod = tp.dataset.pack.split("/")[3];
    if (name) document.title = `${name} · ${mod} ${tp.dataset.cur} · vergiliplus`;
    document.dispatchEvent(new CustomEvent("vp:build"));
  };
  const render = (tp, b, p) => {
    const i = p.n.indexOf(b), e = i >= 0 && p.b[i];
    const view = tp.querySelector("[data-view]"), used = tp.querySelector("[data-used]");
    tp.dataset.cur = b;
    if (!e) {
      view.innerHTML = `<p class="opaque-note">Not in this module for ${esc(b)}.</p>`;
      used.hidden = true;
    } else {
      const u = p.u[e[1]];
      view.innerHTML = p.v[e[0]];
      used.hidden = !u.length;
      used.querySelector("[data-used-n]").textContent = u.length;
      used.querySelector(".used-list").innerHTML = u.map((x) => `<a href="${esc(slugOf(x))}.html">${esc(x)}</a>`).join("");
    }
    shown(tp);
  };
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
