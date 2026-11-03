// Cross-build diff and member history for type pages (the Changes and History tabs).
// Pure functions over the view HTML that lib/panel.mjs renders (the same strings a
// type's pack holds): rows are matched by their name path (keys()), never by position or
// guessed renames. A member whose offset changed only because something before it was
// added, removed or grew is "shifted", reported as a run with that cause, not as a
// change. Loaded as a classic script (window.vpDiff) and by tests/diff.test.mjs.
(() => {
  const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' };
  const unesc = (s) => s.replace(/&(amp|lt|gt|quot);/g, (m) => ENT[m]);
  const textOf = (h) => unesc(h.replace(/<[^>]*>/g, ""));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const hex = (n) => (n < 0 ? "-0x" + (-n).toString(16) : "0x" + n.toString(16));
  const signed = (n, isEnum) => (n < 0 ? "−" : "+") + (isEnum ? String(Math.abs(n)) : "0x" + Math.abs(n).toString(16));

  // one view -> {kind, size, rows} | {opaque} | {variants: n}
  // rows: {k (key or null), cls, depth, code (html), text, ann, o, bp, sz, open, close}
  const ROW = /<div class="((?:sc-line|sc-member)[^"]*)">(.*?)<\/div>/g;
  const FIELD = /<span class="sc-field">(.*?)<\/span>/;
  function parse(html) {
    if (!html || !html.includes("data-sc")) return { opaque: true };
    const nv = html.match(/data-var="/g);
    if (nv && nv.length > 1) return { variants: nv.length };
    const out = { kind: null, size: null, rows: [] };
    const sz = /<span>size <b>(\d+)/.exec(html);
    if (sz) out.size = +sz[1];
    for (const m of html.matchAll(ROW)) {
      const [, cls, inner] = m;
      const ann = /<span class="sc-ann">\/\* (.*?) \*\/<\/span>$/.exec(inner);
      const code = ann ? inner.slice(0, ann.index) : inner;
      const text = textOf(code);
      if (cls.includes("sc-head")) { out.kind = /^(struct|union|enum)\b/.exec(text.trim())?.[1] || null; continue; }
      if (/sc-(hole|cache|prov)/.test(cls)) continue;
      const t = text.replace(/^ +/, "");
      const depth = Math.max(0, (text.length - t.length) / 4 - 1);
      const f = FIELD.exec(code);
      const r = { k: f ? unesc(f[1]) : null, cls, depth, code, text: t, ann: ann ? textOf(ann[1]) : null, o: null, bp: null, sz: null };
      if (cls.includes("sc-grp")) { if (t.endsWith("{")) r.open = true; else r.close = true; }
      else if (!cls.includes("sc-member")) continue;  // the closing "};"
      else if (r.k == null && cls.includes("k-enum")) r.k = t.split(" = ")[0];
      const a = r.ann && /^(-?0x[0-9a-f]+)(?::(\d+))?(?:\s+(\d+))?/.exec(r.ann);
      if (a) { r.o = parseInt(a[1], 16); r.bp = a[2] != null ? +a[2] : null; r.sz = a[3] != null ? +a[3] : null; }
      else if (r.k) { const b = /^\+0x([0-9a-f]+)/.exec(t); if (b) r.o = parseInt(b[1], 16); }  // untyped: offset inline
      out.rows.push(r);
    }
    keys(out.rows);
    return out;
  }
  // a row's key: its name path, enclosing named members' names then its own
  // ("MitigationFlags2Values.CetUserShadowStacks"); anonymous unions/structs add nothing.
  // A named member of anonymous type is named on its closing row ("} u;"). Unique.
  function keys(rows) {
    const name = new Map(), open = [];
    for (const r of rows) if (r.open) open.push(r); else if (r.close) name.set(open.pop(), r.k);
    const path = [], seen = new Map();
    for (const r of rows) {
      if (r.open) { path.push(name.get(r) || null); continue; }
      if (r.close) path.pop();
      if (r.k == null) continue;
      const k = [...path.filter(Boolean), r.k].join("."), n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      r.k = n > 1 ? `${k}#${n}` : k;
    }
  }

  // A, B: parse() results. -> {isEnum, rows: [{st, r, a}], count, runs, size: [a, b]}
  // st: add | del | type | grew | shift | same | ctx (B's structure rows: open/close of
  // anonymous groups). Removed rows sit after the row that preceded them in A.
  function diff(A, B) {
    const isEnum = B.kind === "enum";
    const am = new Map(A.rows.filter((r) => r.k != null).map((r) => [r.k, r]));
    const bk = new Set(B.rows.filter((r) => r.k != null).map((r) => r.k));
    const gone = new Map();  // key of the preceding kept A row (or "") -> [removed A rows]
    let prev = "";
    for (const r of A.rows) {
      if (r.k == null) continue;
      if (bk.has(r.k)) prev = r.k; else (gone.get(prev) || gone.set(prev, []).get(prev)).push(r);
    }
    const rows = [];
    const flush = (k) => { for (const a of gone.get(k) || []) rows.push({ st: "del", r: a }); };
    flush("");
    for (const r of B.rows) {
      if (r.k == null) { rows.push({ st: "ctx", r }); continue; }
      const a = am.get(r.k);
      let st = "same";
      if (!a) st = "add";
      else if (!isEnum && a.text !== r.text) st = "type";
      else if (a.sz != null && r.sz != null && a.sz !== r.sz) st = "grew";
      else if (a.o !== r.o || a.bp !== r.bp) st = "shift";
      rows.push({ st, r, a });
      flush(r.k);
    }
    // shifted runs: consecutive kept rows with one offset delta, credited to the changes
    // seen since the last unchanged row before the delta changed
    const runs = [];
    let cur = 0, run = null, pending = [];
    for (const x of rows) {
      if (x.st === "ctx") continue;
      if (x.st === "add" || x.st === "del") { pending.push(x); continue; }
      const d = x.r.o != null && x.a.o != null ? x.r.o - x.a.o : 0;
      if (d !== cur) {
        cur = d;
        run = d ? { delta: d, n: 0, first: null, last: null, cause: pending.slice() } : null;
        if (run) runs.push(run);
      }
      if (x.st === "shift" && run) { run.n++; run.first ??= x.r.k; run.last = x.r.k; }
      if (x.st === "type" || x.st === "grew") pending.push(x);
      else pending = [];
    }
    const count = { add: 0, del: 0, type: 0, grew: 0, shift: 0 };
    for (const x of rows) if (x.st in count) count[x.st]++;
    return { isEnum, rows, count, runs: runs.filter((r) => r.n), size: [A.size, B.size] };
  }

  const CHANGE = new Set(["add", "del", "type", "grew"]);
  const why = (x) => `${x.r.k} ${{ add: "added", del: "removed", type: "changed type", grew: "grew" }[x.st]}`;
  const causeText = (c) => !c.length ? "" : c.length <= 2 ? c.map(why).join(", ") : `${why(c[0])} and ${c.length - 1} more`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // summary line + run list (HTML) and the whole diff as text
  function summary(D) {
    const c = D.count, unit = D.isEnum ? "value" : "member";
    const parts = [];
    if (c.add) parts.push(`<span class="df-a">+${c.add} added</span>`);
    if (c.del) parts.push(`<span class="df-r">−${c.del} removed</span>`);
    if (c.type + c.grew) parts.push(`<span class="df-t">~${c.type + c.grew} changed</span>`);
    if (c.shift) parts.push(`<span class="df-s">${c.shift} shifted</span>`);
    if (!parts.length) parts.push(`<span class="df-s">no ${unit} changes</span>`);
    const [sa, sb] = D.size;
    if (sa != null && sb != null && !D.isEnum)
      parts.push(`<span class="df-z">size ${hex(sa)}${sa !== sb ? ` → ${hex(sb)} (${signed(sb - sa)})` : ", same"}</span>`);
    return parts.join("");
  }
  function runsHtml(D) {
    const unit = D.isEnum ? "value" : "member";
    return D.runs.map((r) => `<li><span class="df-d">${signed(r.delta, D.isEnum)}</span> ${plural(r.n, unit)}` +
      ` <span class="df-k">${esc(r.first)}${r.n > 1 ? " … " + esc(r.last) : ""}</span>` +
      (r.cause.length ? ` <span class="df-why">after ${esc(causeText(r.cause))}</span>` : "") + `</li>`).join("");
  }

  const MK = { add: "+", del: "−", type: "~", grew: "~", was: "~", shift: " ", same: " ", ctx: " " };
  function row(st, r, ann) {
    const cls = r.cls.replace(/\blink\b/, "").trim();
    return `<div class="${cls} df-row d-${st}"><span class="df-mk">${MK[st]}</span><span class="sc-code">${r.code.replace(/^<span class="sc-code">/, "").replace(/<\/span>$/, "")}</span>` +
      (ann != null ? `<span class="sc-ann">/* ${ann} */</span>` : "") + `</div>`;
  }
  const old = (s) => `<span class="df-old">${esc(s)} →</span> `;
  function rowsOf(x) {
    const { st, r, a } = x;
    if (st === "ctx") return [[st, row("ctx", r, r.ann != null ? esc(r.ann) : null), r, r.ann]];
    if (st === "del") return [[st, row("del", r, "was " + esc(r.ann ?? "")), r, "was " + (r.ann ?? "")]];
    const o = (v) => (v.o == null ? "" : hex(v.o) + (v.bp != null ? ":" + v.bp : ""));
    if (st === "type") return [["was", row("was", a, esc(a.ann ?? "")), a, a.ann], [st, row(st, r, esc(r.ann ?? "")), r, r.ann]];
    if (st === "grew") {
      const t = `${o(r)}  ${a.sz} → ${r.sz}`;
      return [[st, row(st, r, `${o(a) !== o(r) ? old(o(a)) : ""}${esc(o(r))}  ${old(String(a.sz))}${r.sz}`), r, (o(a) !== o(r) ? o(a) + " → " : "") + t]];
    }
    if (st === "shift") {
      const rest = r.sz != null ? `  ${r.sz}` : "";
      return [[st, row(st, r, `${old(o(a))}${esc(o(r))}${rest}`), r, `${o(a)} → ${o(r)}${rest}`]];
    }
    return [[st, row(st, r, r.ann != null ? esc(r.ann) : null), r, r.ann]];
  }

  // the diff as a C listing: changed rows with one row of context either side; the rest
  // folds into "⋯ n unchanged members" lines that open in place. -> {html, text}
  function listing(D, head) {
    const lines = D.rows.map(rowsOf);
    const show = D.rows.map((x, i) => CHANGE.has(x.st));
    const vis = show.map((s, i) => s || show[i - 1] || show[i + 1]);
    const unit = D.isEnum ? "value" : "member";
    let html = "", text = [head], fold = null;
    const endFold = () => {
      if (!fold) return;
      const ds = [...fold.deltas].map((d) => signed(d, D.isEnum)).join(", ");
      const what = !fold.s ? plural(fold.n, "unchanged " + unit)
        : fold.s === fold.n ? `${plural(fold.n, unit)} shifted ${ds}` : `${plural(fold.n, unit)}, ${fold.s} shifted ${ds}`;
      html += `<div class="sc-line df-more" data-df-open tabindex="0" role="button"><span class="df-mk">⋯</span><span class="sc-code">${what}</span></div>` +
        `<div class="df-fold" hidden>${fold.html}</div>`;
      text.push(`  ⋯ ${what}`);
      fold = null;
    };
    D.rows.forEach((x, i) => {
      for (const [st, h, r, ann] of lines[i]) {
        if (vis[i]) {
          endFold();
          html += h;
          text.push(`${MK[st]} ${r.text}${ann ? " ".repeat(Math.max(2, 60 - r.text.length - 2)) + "/* " + ann + " */" : ""}`);
        } else {
          fold ||= { n: 0, s: 0, deltas: new Set(), html: "" };
          fold.html += h;
          if (r.k != null) fold.n++;
          if (x.st === "shift" && r.k != null) { fold.s++; fold.deltas.add(x.r.o - x.a.o); }
        }
      }
    });
    endFold();
    text.push("};");
    return { html, text: text.join("\n") };
  }

  // History: views = [{build, label, title, st: "d" | "o", view}] oldest first.
  // Rows: the type's top-level names (members of anonymous unions/structs included),
  // newest build's order first; by default only those that appear or vanish.
  function history(views, cur, all) {
    const cols = views.map((v) => {
      if (v.st !== "d") return { ...v, m: null };
      const P = parse(v.view);
      if (!P.rows) return { ...v, m: null };
      const m = new Map();
      for (const r of P.rows) if (r.k != null && !r.k.includes(".")) m.set(r.k, r.o);
      return { ...v, m, size: P.size, kind: P.kind };
    });
    const keys = [];
    const seen = new Set();
    for (let i = cols.length - 1; i >= 0; i--) if (cols[i].m) for (const k of cols[i].m.keys()) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    const def = cols.filter((c) => c.m);
    const moves = (k) => def.some((c, i) => i > 0 && c.m.has(k) !== def[i - 1].m.has(k));
    const list = all ? keys : keys.filter(moves);
    const maxS = Math.max(1, ...def.map((c) => c.size || 0));
    const isEnum = def.at(-1)?.kind === "enum";
    const th = cols.map((c) => `<th class="${c.build === cur ? "cur" : ""}${c.m ? "" : " op"}" title="${esc(c.title)}"><a href="#${esc(c.build)}"><span>${esc(c.label)}</span></a></th>`).join("");
    const sizeRow = isEnum ? "" : `<tr class="hs-size"><th>size</th>${cols.map((c) => `<td class="${c.build === cur ? "cur" : ""}${c.m ? "" : " op"}" title="${esc(c.label)}: ${c.size != null ? c.size + " bytes" : "no layout"}">` +
      (c.size ? `<i style="height:${(c.size / maxS * 100).toFixed(1)}%"></i>` : "") + `</td>`).join("")}</tr>`;
    const body = list.map((k) => {
      let last;  // previous column with a layout
      const tds = cols.map((c) => {
        const cl = c.build === cur ? " cur" : "";
        if (!c.m) return `<td class="op${cl}"></td>`;
        const has = c.m.has(k), v = c.m.get(k), p = last;
        last = c;
        let s = "";
        if (has) s = !p ? "p" : !p.m.has(k) ? "n" : p.m.get(k) !== v ? "m" : "p";
        else if (p && p.m.has(k)) s = "x";
        const tip = `${c.label}: ${has ? (v == null ? "present" : hex(v)) : "absent"}`;
        return `<td class="${s}${cl}" title="${esc(tip)}">${s ? `<a href="#${esc(c.build)}"></a>` : ""}</td>`;
      }).join("");
      return `<tr><th>${esc(k)}</th>${tds}</tr>`;
    }).join("");
    const unit = isEnum ? "value" : "member";
    return {
      html: `<div class="hs-scroll"><table class="hs"><thead><tr><th></th>${th}</tr></thead><tbody>${sizeRow}${body}</tbody></table></div>`,
      shown: list.length, total: keys.length, unit,
      empty: !list.length,
    };
  }

  const api = { parse, diff, summary, runsHtml, listing, history, causeText };
  globalThis.vpDiff = api;
})();
