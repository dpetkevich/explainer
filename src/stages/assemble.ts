import { readFileSync, writeFileSync } from "node:fs";
import { templatePath } from "../lib/prompts.js";
import type { ConceptMap, Storyboard } from "../lib/schemas.js";
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

  const sections = included
    .map((scene) => {
      const html = readFileSync(paths.sceneHtml(ctx, scene.id), "utf8");
      return `<section class="scene" id="${escapeHtml(scene.id)}">
  <h2>${escapeHtml(scene.title)}</h2>
  <p class="caption">${escapeHtml(scene.caption)}</p>
  <iframe
    class="scene-frame"
    data-scene-id="${escapeHtml(scene.id)}"
    srcdoc="${escapeSrcdoc(html)}"
    loading="lazy"
    title="${escapeHtml(scene.title)}"
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
  const out = template
    .replaceAll("{{title}}", escapeHtml(storyboard.title))
    .replaceAll("{{hook}}", escapeHtml(storyboard.hook))
    .replaceAll("{{scenes}}", sections)
    .replaceAll("{{footer}}", footer);

  const outPath = paths.explainer(ctx);
  writeFileSync(outPath, out);
  info("assemble", `wrote ${outPath} (${included.length} scenes)`);
  return outPath;
}
