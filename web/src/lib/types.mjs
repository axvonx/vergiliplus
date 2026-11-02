// The type graph of one doc (data/<module>-<build>-<arch>.json) and C type expressions
// over it. Expressions are *segments*, not markup:
//   {t}               plain text
//   {t, kw: true}     a C keyword
//   {t, ref: name}    a type name; linked when it is documented in this doc
// so the same rendering feeds plain text (copy, golden tests) and HTML (the site).

// pointer width per arch; everything else in BASE_SIZES is LLP64 on every arch
const PTR_SIZE = { x86: 4, x64: 8, arm64: 8, arm: 4, ia64: 8, mips: 4, alpha: 4, ppc: 4 };
const BASE_SIZES = {
  "char": 1, "signed char": 1, "unsigned char": 1, "bool": 1,
  "short": 2, "unsigned short": 2, "wchar_t": 2, "__wchar_t": 2,
  "int": 4, "unsigned int": 4, "long": 4, "unsigned long": 4, "float": 4,
  "__int64": 8, "unsigned __int64": 8, "double": 8, "long long": 8,
};
const KW = new Set(["struct", "union", "enum", "const", "volatile", "void", "char",
  "bool", "short", "int", "long", "float", "double", "signed", "unsigned",
  "__int64", "wchar_t", "__wchar_t"]);
// MSVC's name for every anonymous aggregate: not a real type
export const ANON = /^<(unnamed|anonymous)-tag>$/;
const AGG = ["struct", "union", "enum"];

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const slug = (s) => s.replace(/[^A-Za-z0-9_.-]/g, "_");

// segments -> plain text / HTML (links are relative: sibling <Type>.html in a build dir)
export const text = (segs) => segs.map((s) => s.t).join("");
export const html = (segs, T) => segs.map((s) =>
  s.kw ? `<span class="kw">${esc(s.t)}</span>`
  : s.ref && T && T.hasPage(s.ref) ? `<a class="str-link" href="${esc(slug(s.ref))}.html">${esc(s.t)}</a>`
  : s.ref ? `<span class="str-link">${esc(s.t)}</span>`
  : esc(s.t)).join("");

const kw = (t) => ({ t, kw: true });
// keyword words inside base names too ("unsigned long", "void*")
const words = (name) => name.split(/([A-Za-z_]\w*)/).filter(Boolean)
  .map((w) => (KW.has(w) ? kw(w) : { t: w }));

export class Types {
  constructor(doc) {
    this.t = doc.types; this.named = doc.named; this.opaque = doc.opaque || {};
    this.ptr = PTR_SIZE[doc.arch] ?? 8;
    this.prov = doc.provenance || null; this.provTypes = doc.provenanceTypes || {};
  }
  // where a layout not from a public PDB came from: "source: …" / "computed: …", or null
  provenance(name) {
    const p = this.provTypes[name] || this.prov;
    return p ? `${p.kind}: ${p.note}` : null;
  }
  // has a page in this doc: documented, or opaque (declared/mentioned only)
  hasPage(name) { return name in this.named || name in this.opaque; }
  get(idx) { return this.t[idx] || { kind: "other" }; }
  // a forward reference resolves to its definition: [idx, node]
  derefFwd(idx) {
    const n = this.get(idx);
    if (AGG.includes(n.kind) && n.forward) return [n.forward, this.get(n.forward)];
    return [idx, n];
  }
  sizeof(idx) {
    const n = this.get(idx);
    switch (n.kind) {
      case "pointer": return this.ptr;
      case "base": return BASE_SIZES[n.name] ?? (String(n.name).endsWith("*") ? this.ptr : 0);
      case "modifier": return this.sizeof(n.referent);
      case "array": return n.bytes || 0;
      case "struct": case "union": case "enum": {
        const [, d] = this.derefFwd(idx);
        return d.size || (n.kind === "enum" ? 4 : 0);
      }
      default: return 0;
    }
  }
  // the aggregate a member's type names, through pointers/arrays/modifiers
  refName(idx) {
    const n = this.get(idx);
    if (n.kind === "pointer" || n.kind === "modifier") return this.refName(n.referent);
    if (n.kind === "array") return this.refName(n.element);
    if (n.kind === "bitfield") return this.refName(n.type);
    if (AGG.includes(n.kind)) return this.derefFwd(idx)[1].name || n.name || null;
    return null;
  }
  // colour class of a member row
  memberKind(idx) {
    const n = this.get(idx);
    if (n.kind === "modifier") return this.memberKind(n.referent);
    if (n.kind === "pointer" && this.get(n.referent).kind === "proc") return "proc";
    if (n.kind === "base") return String(n.name).endsWith("*") ? "pointer" : "base";
    return n.kind; // pointer | array | struct | union | enum | bitfield
  }

  // C declarator split around the field name: `${pre} name${suf}`, as segments
  typeParts(idx) {
    const n = this.get(idx);
    switch (n.kind) {
      case "base": return { pre: words(n.name || "void"), suf: [] };
      case "modifier": {
        const { pre, suf } = this.typeParts(n.referent);
        const mods = [n.volatile && "volatile", n.const && "const"].filter(Boolean)
          .flatMap((w) => [kw(w), { t: " " }]);
        return { pre: [...mods, ...pre], suf };
      }
      case "pointer": {
        const ref = this.get(n.referent);
        if (ref.kind === "proc")
          return { pre: [...this.typeParts(ref.return).pre, { t: " (*" }],
                   suf: [{ t: ")(" }, ...this.argList(ref), { t: ")" }] };
        const { pre, suf } = this.typeParts(n.referent);
        return { pre: [...pre, { t: "*" }], suf };
      }
      case "array": {
        const { pre, suf } = this.typeParts(n.element);
        const count = Math.floor((n.bytes || 0) / (this.sizeof(n.element) || 1));
        return { pre, suf: [{ t: `[${count}]` }, ...suf] };
      }
      case "struct": case "union": case "enum": {
        const [, d] = this.derefFwd(idx);
        const name = d.name || n.name;
        return { pre: [kw(d.kind || n.kind), { t: " " }, { t: name, ref: name }], suf: [] };
      }
      case "bitfield": return this.typeParts(n.type);
      default: return { pre: [kw("void")], suf: [] };
    }
  }
  // function-pointer parameters; data without a param list -> "()"
  argList(proc) {
    if (!proc.args) return [];
    const al = this.get(proc.args).args || [];
    if (!al.length) return [kw("void")];
    return al.flatMap((a, i) => {
      const sep = i ? [{ t: ", " }] : [];
      if (a === "0x0") return [...sep, { t: "..." }];
      const { pre, suf } = this.typeParts(a);
      return [...sep, ...pre, ...suf];
    });
  }
}
