import { readFileSync, writeFileSync } from "node:fs";
import { callModel, MODELS, stripJsonFences } from "../lib/anthropic.js";
import { stageHash, isFresh, recordHash } from "../lib/cache.js";
import { loadPrompt, loadPromptRaw } from "../lib/prompts.js";
import { StoryboardSchema, type ConceptMap, type Storyboard } from "../lib/schemas.js";
import { info, warn, StageError } from "../lib/log.js";
import { paths, type Ctx } from "../lib/context.js";

export async function runStoryboard(ctx: Ctx, conceptMap: ConceptMap): Promise<Storyboard> {
  const conceptMapJson = JSON.stringify(conceptMap, null, 2);
  const promptRaw = loadPromptRaw("storyboard");
  const hash = stageHash({
    artifacts: [conceptMapJson, ctx.audienceRaw, String(ctx.maxScenes)],
    prompt: promptRaw,
    model: MODELS.planning,
  });
  const hashFile = paths.stageHashFile(ctx, "storyboard");
  const out = paths.storyboard(ctx);

  if (!ctx.force && isFresh(hashFile, hash, [out])) {
    info("storyboard", "cache hit — skipping");
    return StoryboardSchema.parse(JSON.parse(readFileSync(out, "utf8")));
  }

  const prompt = loadPrompt("storyboard", {
    audience: ctx.audienceRaw,
    conceptMap: conceptMapJson,
    maxScenes: String(ctx.maxScenes),
  });

  info("storyboard", `writing storyboard with ${MODELS.planning}`);
  const raw = await callModel({
    model: MODELS.planning,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 16000,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    writeFileSync(out + ".raw.txt", raw);
    throw new StageError("storyboard", "model did not return valid JSON (raw response saved)", out + ".raw.txt");
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
  if (board.scenes.length > ctx.maxScenes) {
    warn("storyboard", `model returned ${board.scenes.length} scenes; keeping first ${ctx.maxScenes}`);
    board = { ...board, scenes: board.scenes.slice(0, ctx.maxScenes) };
  }

  writeFileSync(out, JSON.stringify(board, null, 2));
  recordHash(hashFile, hash);
  info("storyboard", `wrote ${out} (${board.scenes.length} scenes)`);
  return board;
}
