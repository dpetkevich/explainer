import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { templatePath } from "../lib/prompts.js";
import { renderRichText, stripMath } from "../lib/mathml.js";
import { EndorsementsSchema, type ConceptMap, type Storyboard } from "../lib/schemas.js";
import type { QaSummary } from "./qa.js";
import { info, warn } from "../lib/log.js";
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
      return `  <li>
    <span class="check" aria-hidden="true">✓</span>
    <a href="${escapeHtml(e.link)}" rel="noopener">${escapeHtml(e.name)}</a>
    — ${escapeHtml(e.title)}, ${escapeHtml(e.affiliation)}
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
  <h2>${renderRichText(scene.part)}</h2>${lede ? `\n  <p class="part-lede">${renderRichText(lede)}</p>` : ""}
</header>
`;
      }
      const html = injectEmbedStyle(readFileSync(paths.sceneHtml(ctx, scene.id), "utf8"));
      return `${partHeading}<section class="scene" id="${escapeHtml(scene.id)}">
  <h3>${renderRichText(scene.title)}</h3>
  <p class="caption">${renderRichText(scene.caption)}</p>
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
  const footer = `Source: <em>${escapeHtml(conceptMap.paper.title)}</em>${
    authors ? ` — ${escapeHtml(authors)}` : ""
  }. Explainer generated ${generated}.`;

  const template = readFileSync(templatePath("explainer.html"), "utf8");
  // Function replacements: string replacements interpret `$&`/`$'` patterns,
  // which corrupts scene code containing dollar signs (e.g. `"$" + value`).
  const out = template
    .replaceAll("{{title}}", () => escapeHtml(storyboard.title))
    .replaceAll("{{hook}}", () => renderRichText(storyboard.hook))
    .replaceAll("{{endorsements}}", () => renderEndorsements(ctx.outDir))
    .replaceAll("{{scenes}}", () => sections)
    .replaceAll("{{footer}}", () => footer);

  const outPath = paths.explainer(ctx);
  writeFileSync(outPath, out);
  info("assemble", `wrote ${outPath} (${included.length} scenes)`);
  return outPath;
}
