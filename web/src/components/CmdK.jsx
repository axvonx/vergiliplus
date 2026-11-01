/** @jsxImportSource preact */
import { useState, useEffect, useRef, useMemo } from "preact/hooks";

const KDOT = { struct: "#bd93f9", union: "#ff79c6", enum: "#50fa7b" };
const MODLABEL = { ntoskrnl: "kernel", ntdll: "userland" };
const href = (it) => `/v/${it.a}/${it.b}/${it.m}/${it.s}.html`;

function curCtx() {
  const m = location.pathname.match(/^\/v\/([^/]+)\/([^/]+)\/([^/.]+)/);
  return m ? { a: m[1], b: m[2], m: m[3] } : null;
}

export default function CmdK() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [here, setHere] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ(""); setSel(0); setHere(curCtx());
    if (!items) fetch("/search-index.json").then((r) => r.json()).then(setItems).catch(() => setItems([]));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const hits = useMemo(() => {
    const v = q.toLowerCase().trim();
    if (!items || !v) return [];
    const inHere = (it) => here && it.a === here.a && it.b === here.b && it.m === here.m;
    const out = [];
    for (const it of items) {
      const n = it.n.toLowerCase();
      const i = n.indexOf(v);
      if (i < 0) continue;
      // lower is better: current context first, then prefix match, then position, then shorter name
      out.push([(inHere(it) ? 0 : 1e6) + (i === 0 ? 0 : 1e4) + i * 100 + n.length, it]);
    }
    out.sort((x, y) => x[0] - y[0]);
    return out.slice(0, 60).map((x) => x[1]);
  }, [items, q, here]);

  const go = (it) => { if (it) location.href = href(it); };
  const onKeyNav = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(hits[sel]); }
  };

  if (!open) return null;
  return (
    <div class="ck-ov" onClick={() => setOpen(false)}>
      <div class="ck" onClick={(e) => e.stopPropagation()}>
        <input ref={inputRef} class="ck-input" placeholder="Search every type in every build…  (↑↓ ↵ esc)"
               value={q} onInput={(e) => { setQ(e.currentTarget.value); setSel(0); }} onKeyDown={onKeyNav} />
        <div class="ck-list">
          {hits.map((it, i) => (
            <div class={"ck-item" + (i === sel ? " sel" : "")} onMouseEnter={() => setSel(i)} onClick={() => go(it)}>
              <i class="sb-dot" style={{ background: KDOT[it.k] || "#6272a4" }} />
              <span class="ck-name">{it.n}</span>
              <span class="ck-kind">{MODLABEL[it.m]} · {it.b}</span>
            </div>
          ))}
          {items === null && <div class="ck-empty">Loading index…</div>}
          {items && q.trim() && hits.length === 0 && <div class="ck-empty">No matches</div>}
          {items && !q.trim() && <div class="ck-empty">{items.length.toLocaleString()} types across every build — start typing</div>}
        </div>
      </div>
    </div>
  );
}
