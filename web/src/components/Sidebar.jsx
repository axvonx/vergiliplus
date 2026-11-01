/** @jsxImportSource preact */
import { useState, useEffect, useMemo, useRef } from "preact/hooks";

const KDOT = { struct: "#bd93f9", union: "#ff79c6", enum: "#50fa7b" };
const KINDS = ["all", "struct", "union", "enum"];
const MODLABEL = { ntoskrnl: "kernel", ntdll: "userland" };

// /v/<arch>/<build>/<module>/<slug>.html -> { ctx: "/v/a/b/m", slug }
function parseLoc() {
  const m = location.pathname.match(/^\/v\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\.html$/);
  if (!m) return null;
  return { arch: m[1], build: m[2], module: m[3], ctx: `/v/${m[1]}/${m[2]}/${m[3]}`, slug: decodeURIComponent(m[4]) };
}

export default function Sidebar() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [loc, setLoc] = useState(null);
  const loaded = useRef("");

  useEffect(() => {
    const sync = () => {
      const l = parseLoc();
      setLoc(l);
      if (l && loaded.current !== l.ctx) {
        loaded.current = l.ctx;
        setItems([]);
        fetch(`/ti/${l.arch}/${l.build}/${l.module}.json`).then((r) => r.json()).then(setItems).catch(() => {});
      }
    };
    sync();
    document.addEventListener("astro:page-load", sync);
    return () => document.removeEventListener("astro:page-load", sync);
  }, []);

  // keep the active entry in view after navigation
  useEffect(() => {
    document.querySelector(".sb-item.active")?.scrollIntoView({ block: "nearest" });
  }, [loc, items]);

  const shown = useMemo(() => {
    const v = q.toLowerCase();
    return items.filter((it) => (kind === "all" || it.k === kind) && (!v || it.n.toLowerCase().includes(v)));
  }, [items, q, kind]);

  const counts = useMemo(() => {
    const c = { all: items.length, struct: 0, union: 0, enum: 0 };
    for (const it of items) c[it.k]++;
    return c;
  }, [items]);

  return (
    <div class="sb">
      {loc && (
        <a class="sb-ctx" href={`${loc.ctx}.html`}>
          <b>{loc.module}</b> <span>{MODLABEL[loc.module]} · {loc.build}</span>
        </a>
      )}
      <div class="sb-top">
        <input class="sb-filter" placeholder="filter types…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        <div class="sb-kinds">
          {KINDS.map((k) => (
            <button class={"sb-kind" + (kind === k ? " on" : "")} onClick={() => setKind(k)} title={`${counts[k] || 0} ${k}`}>
              {k === "all" ? "all" : k[0].toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div class="sb-count">{shown.length} types</div>
      <nav class="sb-list">
        {loc && shown.map((it) => (
          <a class={"sb-item" + (it.s === loc.slug ? " active" : "")} href={`${loc.ctx}/${it.s}.html`}>
            <i class="sb-dot" style={{ background: KDOT[it.k] || "#6272a4" }} />{it.n}
          </a>
        ))}
      </nav>
    </div>
  );
}
