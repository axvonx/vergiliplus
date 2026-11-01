/** @jsxImportSource preact */
import { useState } from "preact/hooks";

const COLORS = {
  pointer: "#8be9fd", struct: "#bd93f9", union: "#ff79c6", enum: "#50fa7b",
  base: "#6272a4", array: "#ffb86c", bitfield: "#f1fa8c", proc: "#ff5555",
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const hx = (n) => "0x" + n.toString(16);

export default function StructCode({ layout, plain }) {
  const [meta, setMeta] = useState(true);
  const [hover, setHover] = useState(null);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(plain);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div class="sc">
      <pre class="sc-pre"><code>
        <div class="sc-ctrls">
          <button class={"sc-tgl" + (meta ? " on" : "")} aria-pressed={meta} onClick={() => setMeta(!meta)}>
            <span class="sc-box">{meta ? "✓" : ""}</span>Metadata
          </button>
          <button class="sc-copy" onClick={copy}>{copied ? "copied ✓" : "copy"}</button>
        </div>
        <div class="sc-line sc-head"><span class="hljs-keyword">{layout.kind}</span> {layout.name}{" {"}</div>
        {layout.rows.map((r, i) => {
          if (r.hole != null) {
            if (!meta) return null;
            return (
              <div class="sc-line sc-hole">
                <span class="sc-code">{`    /* ${r.hole} byte${r.hole === 1 ? "" : "s"} padding */`}</span>
              </div>
            );
          }
          if (r.cacheline != null) {
            if (!meta) return null;
            return (
              <div class="sc-line sc-cache">
                <span class="sc-code">{`    /* ── cacheline ${r.cacheline} boundary (${r.bytes} bytes) ── */`}</span>
              </div>
            );
          }
          const bits = r.bits != null
            ? ` <span class="hljs-keyword">:</span> <span class="hljs-number">${r.bits}</span>` : "";
          const html = `${r.typePre} <span class="sc-field">${esc(r.field)}</span>${r.typeSuf}${bits};`;
          const accent = COLORS[r.fkind] || "#44475a";
          return (
            <div
              class={"sc-line sc-member" + (hover === i ? " hl" : "") + (r.reflink ? " link" : "")}
              style={{ "--accent": accent, background: hover === i ? accent + "22" : "" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => { if (r.reflink && e.target.tagName !== "A") location.href = `${r.reflink}.html`; }}
            >
              <span class="sc-code" dangerouslySetInnerHTML={{ __html: "    " + html }} />
              {meta && <span class="sc-ann">{`/* ${hx(r.offset)}  ${r.size} */`}</span>}
            </div>
          );
        })}
        <div class="sc-line">{"};"}</div>
      </code></pre>
    </div>
  );
}
