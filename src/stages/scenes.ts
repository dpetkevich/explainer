import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { callModel, MODELS, extractHtml } from "../lib/anthropic.js";
import { stageHash, isFresh, recordHash } from "../lib/cache.js";
import { loadPrompt, loadPromptRaw } from "../lib/prompts.js";
import type { Storyboard, StoryboardScene } from "../lib/schemas.js";
import { info, StageError } from "../lib/log.js";
import { paths, type Ctx } from "../lib/context.js";

const CONCURRENCY = 3;

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function sceneInputHash(ctx: Ctx, scene: StoryboardScene): string {
  return stageHash({
    artifacts: [JSON.stringify(scene), ctx.audienceRaw],
    prompt: loadPromptRaw("scene"),
    model: MODELS.codegen,
  });
}

async function generateScene(ctx: Ctx, scene: StoryboardScene): Promise<void> {
  const htmlPath = paths.sceneHtml(ctx, scene.id);
  const hashFile = paths.sceneHash(ctx, scene.id);
  const hash = sceneInputHash(ctx, scene);

  const forced = ctx.force || ctx.onlyScene === scene.id;
  if (!forced && isFresh(hashFile, hash, [htmlPath])) {
    info("scenes", `${scene.id}: cache hit — skipping`);
    return;
  }

  const prompt = loadPrompt("scene", {
    scene: JSON.stringify(scene, null, 2),
    audience: ctx.audienceRaw,
    sceneId: scene.id,
  });

  info("scenes", `${scene.id}: generating with ${MODELS.codegen}`);
  const raw = await callModel({
    model: MODELS.codegen,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 20000,
  });
  const html = extractHtml(raw);
  if (!/<!doctype html>/i.test(html)) {
    throw new StageError("scenes", "model did not return a complete HTML document", htmlPath, scene.id);
  }
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html);
  recordHash(hashFile, hash);
  info("scenes", `${scene.id}: wrote ${htmlPath}`);
}

export async function runScenes(ctx: Ctx, storyboard: Storyboard): Promise<void> {
  let scenes = storyboard.scenes;
  if (ctx.onlyScene) {
    scenes = scenes.filter((s) => s.id === ctx.onlyScene);
    if (scenes.length === 0) {
      throw new StageError(
        "scenes",
        `no scene with id "${ctx.onlyScene}" in storyboard (have: ${storyboard.scenes.map((s) => s.id).join(", ")})`,
        paths.storyboard(ctx)
      );
    }
  }
  await pool(scenes, CONCURRENCY, (scene) => generateScene(ctx, scene));

  for (const scene of storyboard.scenes) {
    if (!existsSync(paths.sceneHtml(ctx, scene.id)) && !ctx.onlyScene) {
      throw new StageError("scenes", "scene HTML missing after generation", paths.sceneHtml(ctx, scene.id), scene.id);
    }
  }
}
