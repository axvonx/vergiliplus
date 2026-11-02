// Struct view: loads each page's shared panel (/f/<hash>.html, see lib/panel.mjs), then
// Metadata toggle (remembered), copy, row click-through. Document-level delegation, so
// it survives ClientRouter swaps.
(() => {
  if (window.__vpStruct) return;
  window.__vpStruct = true;
  const KEY = "vp-meta";
  const metaOn = () => { try { return localStorage.getItem(KEY) !== "0"; } catch (e) { return true; } };
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
  // inject the panel; its relative links resolve against this page, as if inline
  const load = () => {
    apply();
    document.querySelectorAll("[data-frag]:not([data-loaded])").forEach((p) => {
      p.dataset.loaded = "1";
      fetch(p.dataset.frag).then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
        .then((h) => { p.innerHTML = h; apply(); })
        .catch(() => {
          delete p.dataset.loaded;
          p.innerHTML = `<p class="opaque-note">Couldn't load this layout. <a href="${p.dataset.frag}">Open it directly</a>.</p>`;
        });
    });
  };
  document.addEventListener("astro:page-load", load);
  if (document.readyState !== "loading") load();
  else document.addEventListener("DOMContentLoaded", load);
})();
