import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import type { Storyboard } from "../lib/schemas.js";
import { StageError, info, warn } from "../lib/log.js";
import { emit } from "../lib/progress.js";
import { paths, type Ctx } from "../lib/context.js";
import { pool, generateScene } from "./scenes.js";
import { qaOneScene, type QaSummary, type SceneResult } from "./qa.js";

const PIPELINE_CONCURRENCY = 4;

/**
 * Per-scene pipeline: each worker runs generate → render → review → repair
 * end-to-end, so wall time is roughly the slowest single scene chain instead
 * of sum(codegen) + sum(qa). A shared Playwright browser serves all workers.
 */
export async function runScenePipeline(ctx: Ctx, storyboard: Storyboard, withQa: boolean): Promise<QaSummary> {
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

  emit(ctx.onEvent, { type: "stage-start", stage: "scenes" });
  if (withQa) mkdirSync(paths.qaDir(ctx), { recursive: true });
  const browser = withQa ? await chromium.launch() : null;

  // Generation errors fail the run (after all siblings finish and cache);
  // QA-chain errors (reviewer glitch, render crash) mark the scene failed
  // rather than killing the pipeline — the rest still ships.
  const genErrors: StageError[] = [];
  const results: SceneResult[] = [];
  try {
    await pool(scenes, PIPELINE_CONCURRENCY, async (scene) => {
      emit(ctx.onEvent, { type: "scene-start", id: scene.id });
      try {
        await generateScene(ctx, scene);
      } catch (err) {
        genErrors.push(
          err instanceof StageError
            ? err
            : new StageError("scenes", err instanceof Error ? err.message : String(err), undefined, scene.id)
        );
        emit(ctx.onEvent, { type: "scene-fail", id: scene.id, kinds: ["generation"] });
        return;
      }
      if (!browser) return;
      try {
        const result = await qaOneScene(ctx, browser, scene);
        results.push(result);
        if (result.status === "pass") {
          emit(ctx.onEvent, { type: "scene-pass", id: scene.id, attempts: result.attempts });
        } else {
          emit(ctx.onEvent, { type: "scene-fail", id: scene.id, kinds: (result.failures ?? []).map((f) => f.kind) });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warn("qa", `${scene.id}: QA errored (${msg}) — marking failed`);
        const result: SceneResult = { id: scene.id, status: "fail", attempts: 0, consoleErrors: [msg] };
        writeFileSync(paths.qaReport(ctx, scene.id), JSON.stringify(result, null, 2));
        results.push(result);
        emit(ctx.onEvent, { type: "scene-fail", id: scene.id, kinds: ["qa-error"] });
      }
    });
  } finally {
    await browser?.close();
  }

  if (genErrors.length > 0) {
    for (const e of genErrors.slice(1)) {
      console.error(`✗ [scenes / scene "${e.sceneId}"] ${e.message}`);
    }
    throw genErrors[0]!;
  }
  if (!withQa) return { scenes: [] };

  // Parallel completion order is arbitrary — restore storyboard order.
  const order = new Map(storyboard.scenes.map((s, i) => [s.id, i]));
  results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  // Merge with prior summary so --scene runs don't clobber other scenes' results.
  const summaryPath = paths.qaSummary(ctx);
  let summary: QaSummary = { scenes: results };
  if (ctx.onlyScene && existsSync(summaryPath)) {
    const prior = JSON.parse(readFileSync(summaryPath, "utf8")) as QaSummary;
    const merged = new Map(prior.scenes.map((s) => [s.id, s]));
    for (const r of results) merged.set(r.id, r);
    summary = { scenes: storyboard.scenes.map((s) => merged.get(s.id)).filter((s): s is SceneResult => !!s) };
  }
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const passed = summary.scenes.filter((s) => s.status === "pass").length;
  info("qa", `${passed}/${summary.scenes.length} scenes passing`);
  return summary;
}
