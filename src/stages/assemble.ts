import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { templatePath } from "../lib/prompts.js";
import { renderRichText, stripMath } from "../lib/mathml.js";
import { EndorsementsSchema, type ConceptMap, type Storyboard } from "../lib/schemas.js";
import { currentPedagogy } from "../lib/pedagogy.js";
import type { QaSummary } from "./qa.js";
import { info, warn } from "../lib/log.js";
import { emit } from "../lib/progress.js";
import { paths, type Ctx } from "../lib/context.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** srcdoc must keep its tags — escape only & and the attribute-delimiting quotes. */
function escapeSrcdoc(html: string): string {
  return html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Uniform embed styling across every scene, applied at assembly so cached scene
// HTML never needs regenerating for presentation changes: math sizing, and no
// internal scrolling (the iframe is sized to the scene's reported height).
const EMBED_STYLE = `<style>math{font-size:1.25em}math[display="block"]{font-size:1.4em}html,body{overflow:hidden}</style>`;

function injectEmbedStyle(html: string): string {
  const idx = html.search(/<\/head>/i);
  return idx >= 0 ? html.slice(0, idx) + EMBED_STYLE + html.slice(idx) : html;
}

/** Render the "Endorsed by" strip from <outDir>/endorsements.json, when present and non-empty. */
function renderEndorsements(outDir: string): string {
  const file = join(outDir, "endorsements.json");
  if (!existsSync(file)) return "";
  const endorsements = EndorsementsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (endorsements.length === 0) return "";
  const items = endorsements
    .map((e) => {
      const note = e.note ? `\n    <blockquote>${escapeHtml(e.note)}</blockquote>` : "";
      const who = e.link
        ? `<a href="${escapeHtml(e.link)}" rel="noopener">${escapeHtml(e.name)}</a>`
        : escapeHtml(e.name);
      const role = [e.title, e.affiliation].filter((s): s is string => Boolean(s)).map(escapeHtml).join(", ");
      return `  <li>
    <span class="check" aria-hidden="true">✓</span>
    ${who}${role ? `\n    — ${role}` : ""}
    <span class="date">· ${escapeHtml(e.date)}</span>${note}
  </li>`;
    })
    .join("\n");
  return `<section class="endorsements">
  <h2>Endorsed by</h2>
  <ul>
${items}
  </ul>
</section>`;
}

export function runAssemble(
  ctx: Ctx,
  conceptMap: ConceptMap,
  storyboard: Storyboard,
  qa: QaSummary
): string {
  const passing = new Set(qa.scenes.filter((s) => s.status === "pass").map((s) => s.id));
  const included = storyboard.scenes.filter((s) => passing.has(s.id));
  const excluded = storyboard.scenes.filter((s) => !passing.has(s.id));
  for (const s of excluded) {
    warn("assemble", `excluding failed scene "${s.id}"`);
  }
  if (included.length === 0) {
    warn("assemble", "no scenes passed QA — the explainer will contain text only");
  }

  const ledes = new Map((storyboard.parts ?? []).map((p) => [p.title, p.lede]));
  let currentPart: string | undefined;
  const sections = included
    .map((scene) => {
      let partHeading = "";
      if (scene.part !== undefined && scene.part !== currentPart) {
        currentPart = scene.part;
        const lede = ledes.get(scene.part);
        partHeading = `<header class="part">
  <h2>${renderRichText(scene.part)}</h2>${lede ? `\n  <div class="part-lede">${renderRichText(lede)}</div>` : ""}
</header>
`;
      }
      const html = injectEmbedStyle(readFileSync(paths.sceneHtml(ctx, scene.id), "utf8"));
      return `${partHeading}<section class="scene" id="${escapeHtml(scene.id)}">
  <h3>${renderRichText(scene.title)}</h3>
  <div class="caption">${renderRichText(scene.caption)}</div>
  <iframe
    class="scene-frame"
    data-scene-id="${escapeHtml(scene.id)}"
    srcdoc="${escapeSrcdoc(html)}"
    loading="lazy"
    scrolling="no"
    title="${escapeHtml(stripMath(scene.title))}"
  ></iframe>
</section>`;
    })
    .join("\n\n");

  const authors = conceptMap.paper.authors.join(", ");
  const generated = new Date().toISOString().slice(0, 10);

  // Under the hook: a link to the source paper (when the input was a URL/arXiv)
  // and the pedagogy-style version that produced this explainer. Pin both in
  // generation-meta.json at first assembly so a later model-free reassembly
  // keeps the original values (a paper made under pedagogy v1 stays labelled v1).
  const metaFile = join(ctx.outDir, "generation-meta.json");
  interface GenMeta { source?: string; pedagogy: { version: string; label: string } }
  let meta: GenMeta;
  if (existsSync(metaFile)) {
    meta = JSON.parse(readFileSync(metaFile, "utf8")) as GenMeta;
  } else {
    const sourceUrl = ctx.inputKind === "url" || ctx.inputKind === "arxiv" ? ctx.input : undefined;
    meta = { source: sourceUrl, pedagogy: currentPedagogy() };
    writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");
  }
  // Link to the source paper, labeled with the paper's own title. Opens in a new
  // tab: the explainer is viewed inside an iframe, and most paper hosts (arXiv)
  // refuse to be framed, so a same-frame navigation would break.
  const paperLink = meta.source
    ? `<a href="${escapeHtml(meta.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(conceptMap.paper.title)}</a><span class="sep"> · </span>`
    : "";
  const pageLinks =
    `  <p class="page-links">${paperLink}<span class="pedagogy" title="Pedagogy style version — history in prompts/pedagogy.json">` +
    `Pedagogy v${escapeHtml(meta.pedagogy.version)} · ${escapeHtml(meta.pedagogy.label)}</span></p>`;
  const footer = `Source: <em>${escapeHtml(conceptMap.paper.title)}</em>${
    authors ? ` — ${escapeHtml(authors)}` : ""
  }. Explainer generated ${generated}.`;

  const template = readFileSync(templatePath("explainer.html"), "utf8");
  // Function replacements: string replacements interpret `$&`/`$'` patterns,
  // which corrupts scene code containing dollar signs (e.g. `"$" + value`).
  const out = template
    .replaceAll("{{title}}", () => escapeHtml(storyboard.title))
    .replaceAll("{{hook}}", () => renderRichText(storyboard.hook))
    .replaceAll("{{links}}", () => pageLinks)
    .replaceAll("{{endorsements}}", () => renderEndorsements(ctx.outDir))
    .replaceAll("{{scenes}}", () => sections)
    .replaceAll("{{footer}}", () => footer);

  const outPath = paths.explainer(ctx);
  writeFileSync(outPath, out);
  info("assemble", `wrote ${outPath} (${included.length} scenes)`);
  emit(ctx.onEvent, { type: "assembled", scenesIncluded: included.length });
  return outPath;
}
