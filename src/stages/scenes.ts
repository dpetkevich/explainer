import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { callModel, MODELS, extractHtml } from "../lib/anthropic.js";
import { stageHash, isFresh, recordHash } from "../lib/cache.js";
import { loadPrompt, loadPromptRaw } from "../lib/prompts.js";
import type { StoryboardScene } from "../lib/schemas.js";
import { info, StageError } from "../lib/log.js";
import { paths, type Ctx } from "../lib/context.js";

export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
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

export async function generateScene(ctx: Ctx, scene: StoryboardScene): Promise<void> {
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
  let html = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await callModel({
      model: MODELS.codegen,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 32000,
    });
    html = extractHtml(raw);
    if (/<!doctype html>/i.test(html) && /<\/html>/i.test(html)) break;
    writeFileSync(htmlPath + `.raw${attempt}.txt`, raw);
    if (attempt === 2) {
      throw new StageError(
        "scenes",
        "model did not return a complete HTML document after 2 attempts (raw responses saved)",
        htmlPath + ".raw2.txt",
        scene.id
      );
    }
    info("scenes", `${scene.id}: incomplete HTML, retrying`);
  }
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html);
  recordHash(hashFile, hash);
  info("scenes", `${scene.id}: wrote ${htmlPath}`);
}
