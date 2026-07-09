import { readFileSync, writeFileSync } from "node:fs";
import { callModel, MODELS, stripJsonFences } from "../lib/anthropic.js";
import { stageHash, isFresh, recordHash } from "../lib/cache.js";
import { loadPrompt, loadPromptRaw } from "../lib/prompts.js";
import { stripMath } from "../lib/mathml.js";
import { StoryboardSchema, type ConceptMap, type Storyboard } from "../lib/schemas.js";
import { info, warn, StageError } from "../lib/log.js";
import { paths, type Ctx } from "../lib/context.js";

export interface StoryboardResult {
  board: Storyboard;
  /** True when the storyboard came from cache (i.e. it has already passed the script review gate). */
  fromCache: boolean;
}

export async function runStoryboard(ctx: Ctx, conceptMap: ConceptMap): Promise<StoryboardResult> {
  const conceptMapJson = JSON.stringify(conceptMap, null, 2);
  const promptRaw = loadPromptRaw("storyboard");
  const hash = stageHash({
    artifacts: [conceptMapJson, ctx.audienceRaw, String(ctx.maxScenes ?? "uncapped")],
    prompt: promptRaw,
    model: MODELS.planning,
  });
  const hashFile = paths.stageHashFile(ctx, "storyboard");
  const out = paths.storyboard(ctx);

  if (!ctx.force && isFresh(hashFile, hash, [out])) {
    info("storyboard", "cache hit — skipping");
    // Re-validate on every load so hand-edits can't ship a malformed storyboard,
    // and re-render the script so it always reflects those edits.
    const board = StoryboardSchema.parse(JSON.parse(readFileSync(out, "utf8")));
    writeFileSync(paths.script(ctx), renderScript(ctx, board));
    return { board, fromCache: true };
  }

  const prompt = loadPrompt("storyboard", {
    audience: ctx.audienceRaw,
    conceptMap: conceptMapJson,
    sceneBudget: ctx.maxScenes
      ? `at most ${ctx.maxScenes} scenes`
      : "as many scenes as the concept ladder needs — typically 6–10 for a dense paper",
  });

  info("storyboard", `writing storyboard with ${MODELS.planning}`);
  // Long-context calls occasionally end mid-output; retry incomplete JSON.
  const MAX_ATTEMPTS = 3;
  let parsed: unknown;
  for (let attempt = 1; ; attempt++) {
    const raw = await callModel({
      model: MODELS.planning,
      messages: [{ role: "user", content: prompt }],
      // Uncapped scene counts + per-scene teaches/requires fields produce large JSON,
      // and the planning model's extended thinking also counts against max_tokens —
      // hard papers can burn 25k+ tokens reasoning before emitting a byte of output.
      maxTokens: 64000,
    });
    try {
      parsed = JSON.parse(stripJsonFences(raw));
      break;
    } catch {
      writeFileSync(out + ".raw.txt", raw);
      if (attempt >= MAX_ATTEMPTS) {
        throw new StageError(
          "storyboard",
          `model did not return valid JSON after ${MAX_ATTEMPTS} attempts (raw response saved)`,
          out + ".raw.txt"
        );
      }
      warn("storyboard", `attempt ${attempt}: response was not valid JSON (${raw.length} chars) — retrying`);
    }
  }
  const result = StoryboardSchema.safeParse(parsed);
  if (!result.success) {
    writeFileSync(out + ".invalid", JSON.stringify(parsed, null, 2));
    throw new StageError(
      "storyboard",
      `storyboard failed schema validation: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      out + ".invalid"
    );
  }
  let board = result.data;

  const conceptIds = new Set(conceptMap.concepts.map((c) => c.id));
  for (const scene of board.scenes) {
    if (!conceptIds.has(scene.conceptId)) {
      warn("storyboard", `scene "${scene.id}" references unknown concept "${scene.conceptId}"`);
    }
  }
  if (ctx.maxScenes && board.scenes.length > ctx.maxScenes) {
    warn("storyboard", `model returned ${board.scenes.length} scenes; keeping first ${ctx.maxScenes}`);
    board = { ...board, scenes: board.scenes.slice(0, ctx.maxScenes) };
  }

  writeFileSync(out, JSON.stringify(board, null, 2));
  writeFileSync(paths.script(ctx), renderScript(ctx, board));
  recordHash(hashFile, hash);
  info("storyboard", `wrote ${out} (${board.scenes.length} scenes)`);
  return { board, fromCache: false };
}

/** Human-readable "script" of the storyboard for review before any graphics are generated. */
export function renderScript(ctx: Ctx, board: Storyboard): string {
  const lines: string[] = [
    `# ${board.title}`,
    "",
    `> ${stripMath(board.hook)}`,
    "",
    `_Reader: ${ctx.audience.background}_`,
    "",
  ];
  const ledes = new Map((board.parts ?? []).map((p) => [p.title, p.lede]));
  let currentPart: string | undefined;
  board.scenes.forEach((scene, i) => {
    if (scene.part !== undefined && scene.part !== currentPart) {
      currentPart = scene.part;
      lines.push(`# Part: ${stripMath(scene.part)}`, "");
      const lede = ledes.get(scene.part);
      if (lede) lines.push(`_${stripMath(lede)}_`, "");
    }
    const v = scene.animatedVariable;
    lines.push(
      `## Scene ${i + 1} — ${stripMath(scene.title)}`,
      "",
      `- **Teaches:** ${stripMath(scene.teaches)}`,
      `- **Builds on:** ${scene.requires.length ? scene.requires.join(", ") : "nothing — foundational"}`,
      `- **Caption:** ${stripMath(scene.caption)}`,
      `- **Interactive:** ${v.control} for ${v.name} (${v.range}) — ${v.whatChangesOnScreen}`
    );
    if (scene.quantitativeAnchor) lines.push(`- **Quantitative anchor:** ${scene.quantitativeAnchor}`);
    lines.push(`- **Physics checks:**`);
    for (const check of scene.physicsChecks) lines.push(`  - ${check}`);
    lines.push("");
  });
  return lines.join("\n");
}
