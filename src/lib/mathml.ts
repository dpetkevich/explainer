/**
 * Captions in storyboard.json may embed inline math as \( ... \) in a tiny
 * LaTeX subset: `_` `^` `{}` `\sqrt{}` `\frac{}{}` `\text{}`, with Unicode
 * Greek and operator characters (Δ, η, ≈, ∝, ·) used directly. renderRichText()
 * converts those segments to native MathML so browsers typeset them like LaTeX
 * with no libraries; everything outside \( ... \) is HTML-escaped verbatim.
 * ($...$ was rejected as a delimiter: captions legitimately contain currency.)
 */

const FUNCTIONS = new Set(["ln", "log", "sin", "cos", "tan", "exp", "min", "max"]);

const ASCII_LETTER = /[A-Za-z]/;
// Greek and letterlike symbols that should render as identifiers, not operators.
const UNICODE_LETTER = /[Ͱ-Ͽᴀ-ᵿℂ-ℱ]/;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface P {
  s: string;
  i: number;
}

/** Parse one atom; `inScript` makes multi-letter runs single upright <mi> (word subscripts). */
function parseAtom(p: P, inScript: boolean): string | null {
  while (p.i < p.s.length && /\s/.test(p.s[p.i]!)) p.i++;
  if (p.i >= p.s.length) return null;
  const c = p.s[p.i]!;

  if (c === "}") return null;

  if (c === "{") {
    p.i++;
    const body = parseSeq(p, inScript);
    if (p.s[p.i] === "}") p.i++;
    return `<mrow>${body}</mrow>`;
  }

  if (c === "\\") {
    p.i++;
    let name = "";
    while (p.i < p.s.length && ASCII_LETTER.test(p.s[p.i]!)) name += p.s[p.i++]!;
    if (name === "sqrt") return `<msqrt>${parseAtom(p, false) ?? ""}</msqrt>`;
    if (name === "frac") {
      const a = parseAtom(p, false) ?? "";
      const b = parseAtom(p, false) ?? "";
      return `<mfrac>${a}${b}</mfrac>`;
    }
    if (name === "text") {
      let raw = "";
      if (p.s[p.i] === "{") {
        p.i++;
        while (p.i < p.s.length && p.s[p.i] !== "}") raw += p.s[p.i++]!;
        if (p.s[p.i] === "}") p.i++;
      }
      return `<mtext>${esc(raw)}</mtext>`;
    }
    if (name === "" && p.s[p.i] === ",") {
      p.i++;
      return `<mspace width="0.167em"></mspace>`;
    }
    return `<mi>${esc(name)}</mi>`;
  }

  if (ASCII_LETTER.test(c)) {
    let run = "";
    let j = p.i;
    while (j < p.s.length && ASCII_LETTER.test(p.s[j]!)) run += p.s[j++]!;
    if (FUNCTIONS.has(run) || (inScript && run.length > 1)) {
      p.i = j;
      return `<mi>${esc(run)}</mi>`; // multi-char <mi> renders upright — right for ln, wet, sp
    }
    p.i++;
    return `<mi>${esc(c)}</mi>`; // single-char <mi> renders italic — right for variables
  }

  if (UNICODE_LETTER.test(c)) {
    p.i++;
    return `<mi>${esc(c)}</mi>`;
  }

  if (/[0-9]/.test(c)) {
    let run = "";
    while (p.i < p.s.length && /[0-9]/.test(p.s[p.i]!)) {
      run += p.s[p.i++]!;
      if (/[.,]/.test(p.s[p.i] ?? "") && /[0-9]/.test(p.s[p.i + 1] ?? "")) run += p.s[p.i++]!;
    }
    return `<mn>${esc(run)}</mn>`;
  }

  p.i++;
  return `<mo>${esc(c)}</mo>`;
}

function parseSeq(p: P, inScript: boolean): string {
  const nodes: string[] = [];
  for (;;) {
    while (p.i < p.s.length && /\s/.test(p.s[p.i]!)) p.i++;
    const c = p.s[p.i];
    if (c === undefined || c === "}") break;
    if (c === "_" || c === "^") {
      p.i++;
      const script = parseAtom(p, true) ?? "<mrow></mrow>";
      const base = nodes.pop() ?? "<mrow></mrow>";
      nodes.push(c === "_" ? `<msub>${base}${script}</msub>` : `<msup>${base}${script}</msup>`);
      continue;
    }
    const atom = parseAtom(p, inScript);
    if (atom === null) break;
    nodes.push(atom);
  }
  return nodes.join("");
}

export function texToMathML(tex: string, display = false): string {
  const body = parseSeq({ s: tex, i: 0 }, false);
  return `<math${display ? ' display="block"' : ""}>${body}</math>`;
}

/** Escape one text run, converting \( ... \) segments to inline MathML. */
function renderInline(text: string): string {
  const parts = text.split(/\\\(([\s\S]*?)\\\)/g);
  return parts.map((part, idx) => (idx % 2 === 1 ? texToMathML(part) : esc(part))).join("");
}

/**
 * Escape text and convert \( ... \) to inline MathML. Also supports a minimal
 * list convention: consecutive lines starting with "- " become a <ul><li>…</li>
 * list (each item still math-aware), so a caption/lede can enumerate discrete
 * items as bullets instead of a comma-run. Callers that may receive a list must
 * host the result in a block element (a <div>, not a <p>).
 */
export function renderRichText(text: string): string {
  if (!/(^|\n)\s*-\s+/.test(text)) return renderInline(text); // fast path: no bullets
  const out: string[] = [];
  let list: string[] = [];
  let buf: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((li) => `<li>${renderInline(li)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushText = () => {
    if (buf.length) out.push(renderInline(buf.join(" ").trim()));
    buf = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s+(.*)$/);
    if (m) {
      flushText();
      list.push(m[1]!);
    } else {
      flushList();
      if (line.trim()) buf.push(line.trim());
    }
  }
  flushText();
  flushList();
  return out.join("");
}

/** Strip \( \)-math markup back to readable plain text (for script.md and terminal digests). */
export function stripMath(text: string): string {
  return text
    .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(/\\\(|\\\)/g, "")
    .replace(/[{}]/g, "");
}
