#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { chromium } from "playwright";
import { AudienceProfileSchema, type Storyboard } from "./lib/schemas.js";
import { stripMath } from "./lib/mathml.js";
import { StageError, reportError, info, warn } from "./lib/log.js";
import { paths, type Ctx, type InputKind } from "./lib/context.js";
import { runIngest } from "./stages/ingest.js";
import { runStoryboard } from "./stages/storyboard.js";
import { pool, generateScene } from "./stages/scenes.js";
import { qaOneScene, type QaSummary, type SceneResult } from "./stages/qa.js";
import { runAssemble } from "./stages/assemble.js";

// Minimal .env loader (KEY=value lines, no expansion) so the key can live in the project.
(() => {
  const envFile = resolve(".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();

const STAGES = ["ingest", "storyboard", "scenes", "qa", "assemble"] as const;
type StageName = (typeof STAGES)[number];

const PIPELINE_CONCURRENCY = 4;

function detectInputKind(input: string): InputKind {
  if (/^https?:\/\//i.test(input)) return "url";
  if (/\.pdf$/i.test(input)) return "pdf";
  if (/\.(md|txt)$/i.test(input)) return "text";
  throw new StageError("cli", `unsupported input "${input}" — expected a .pdf, .md/.txt file, or an http(s) URL`);
}

function slugify(input: string, kind: InputKind): string {
  let base: string;
  if (kind === "url") {
    const path = new URL(input).pathname.replace(/\/+$/, "");
    base = path.split("/").pop() || new URL(input).hostname;
  } else {
    base = basename(input).replace(/\.(pdf|md|txt)$/i, "");
  }
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "explainer";
}

async function timed<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const result = await fn();
  info(stage, `stage finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return result;
}

/**
 * Per-scene pipeline: each worker runs generate → render → review → repair
 * end-to-end, so wall time is roughly the slowest single scene chain instead
 * of sum(codegen) + sum(qa). A shared Playwright browser serves all workers.
 */
async function runScenePipeline(ctx: Ctx, storyboard: Storyboard, withQa: boolean): Promise<QaSummary> {
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

  if (withQa) mkdirSync(paths.qaDir(ctx), { recursive: true });
  const browser = withQa ? await chromium.launch() : null;

  // Generation errors fail the run (after all siblings finish and cache);
  // QA-chain errors (reviewer glitch, render crash) mark the scene failed
  // rather than killing the pipeline — the rest still ships.
  const genErrors: StageError[] = [];
  const results: SceneResult[] = [];
  try {
    await pool(scenes, PIPELINE_CONCURRENCY, async (scene) => {
      try {
        await generateScene(ctx, scene);
      } catch (err) {
        genErrors.push(
          err instanceof StageError
            ? err
            : new StageError("scenes", err instanceof Error ? err.message : String(err), undefined, scene.id)
        );
        return;
      }
      if (!browser) return;
      try {
        results.push(await qaOneScene(ctx, browser, scene));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warn("qa", `${scene.id}: QA errored (${msg}) — marking failed`);
        const result: SceneResult = { id: scene.id, status: "fail", attempts: 0, consoleErrors: [msg] };
        writeFileSync(paths.qaReport(ctx, scene.id), JSON.stringify(result, null, 2));
        results.push(result);
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

const program = new Command();
program
  .name("explain-it")
  .description("Turn a scientific paper (PDF) or technical article (URL) into an interactive HTML explainer")
  .argument("<input>", "path to a PDF (or .md/.txt), or an http(s) URL")
  .option("--out <dir>", "output directory (default: ./explainers/<slug>/)")
  .option("--audience <file>", "audience profile JSON", "./profiles/default.json")
  .option("--reader <text>", "override the audience background (e.g. \"high-school student\")")
  .option("--max-scenes <n>", "optional cap on scenes (default: as many as the storyboard needs)")
  .option("--stage <name>", `run up to a stage: ${STAGES.join(" | ")}`, "assemble")
  .option("--scene <id>", "regenerate a single scene by id, then re-run qa + assemble")
  .option("--force", "ignore cache for the requested stage(s)", false)
  .option("--yes", "skip the script review gate and run straight through", false)
  .option("--open", "open the finished explainer in the default browser", false)
  .action(async (input: string, opts) => {
    try {
      const inputKind = detectInputKind(input);
      if (inputKind !== "url" && !existsSync(input)) {
        throw new StageError("cli", `input file not found: ${input}`);
      }

      const targetStage = opts.stage as StageName;
      if (!STAGES.includes(targetStage)) {
        throw new StageError("cli", `unknown stage "${opts.stage}" — expected one of: ${STAGES.join(", ")}`);
      }
      const targetIdx = STAGES.indexOf(targetStage);

      const audiencePath = resolve(opts.audience);
      if (!existsSync(audiencePath)) {
        throw new StageError("cli", `audience profile not found: ${audiencePath}`);
      }
      let audience = AudienceProfileSchema.parse(JSON.parse(readFileSync(audiencePath, "utf8")));
      if (opts.reader) audience = { ...audience, background: opts.reader };

      let maxScenes: number | undefined;
      if (opts.maxScenes !== undefined) {
        maxScenes = parseInt(opts.maxScenes, 10);
        if (!Number.isInteger(maxScenes) || maxScenes < 1) {
          throw new StageError("cli", `--max-scenes must be a positive integer, got "${opts.maxScenes}"`);
        }
      }

      const outDir = resolve(opts.out ?? join("explainers", slugify(input, inputKind)));
      const ctx: Ctx = {
        input,
        inputKind,
        outDir,
        workDir: join(outDir, "work"),
        audience,
        audienceRaw: JSON.stringify(audience, null, 2),
        maxScenes,
        force: Boolean(opts.force),
        onlyScene: opts.scene,
      };
      mkdirSync(ctx.workDir, { recursive: true });

      // With --scene, upstream artifacts must already exist (never force-refetch them).
      const upstreamCtx: Ctx = ctx.onlyScene ? { ...ctx, force: false } : ctx;

      const conceptMap = await timed("ingest", () => runIngest(upstreamCtx));
      if (targetIdx < 1) return done(ctx, opts.open, null);

      const { board: storyboard, fromCache } = await timed("storyboard", () => runStoryboard(upstreamCtx, conceptMap));
      if (targetIdx < 2) return done(ctx, opts.open, null);

      // Script review gate: a freshly generated storyboard stops the run so the
      // "script" can be reviewed before any graphics are paid for. A cache hit
      // means it was already reviewed on a previous run.
      if (!fromCache && !opts.yes) {
        printScriptGate(ctx, storyboard);
        return;
      }

      const withQa = targetIdx >= STAGES.indexOf("qa");
      const qa = await timed(withQa ? "scenes+qa" : "scenes", () => runScenePipeline(ctx, storyboard, withQa));
      if (targetIdx < 4) return done(ctx, opts.open, null);

      const outPath = runAssemble(ctx, conceptMap, storyboard, qa);
      return done(ctx, opts.open, outPath);
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

function printScriptGate(ctx: Ctx, storyboard: Storyboard): void {
  console.log(`\n${storyboard.title}`);
  console.log(`hook: ${stripMath(storyboard.hook)}\n`);
  let currentPart: string | undefined;
  storyboard.scenes.forEach((scene, i) => {
    if (scene.part !== undefined && scene.part !== currentPart) {
      currentPart = scene.part;
      console.log(`  — ${stripMath(scene.part)} —`);
    }
    console.log(`  ${i + 1}. ${stripMath(scene.title)} — ${stripMath(scene.teaches)}`);
  });
  console.log(`\nfull script: ${paths.script(ctx)}`);
  console.log(
    "\n[gate] review the script, edit work/storyboard.json if needed, then rerun the same command to continue.\n" +
      "       rerun with --force to reject and regenerate the storyboard, or use --yes to skip this gate."
  );
}

function done(ctx: Ctx, open: boolean, explainerPath: string | null): void {
  if (explainerPath) {
    info("done", `explainer ready: ${explainerPath}`);
    if (open) {
      execFile(process.platform === "darwin" ? "open" : "xdg-open", [explainerPath]);
    }
  } else {
    info("done", `stopped after requested stage; artifacts in ${ctx.workDir}`);
  }
}

program.parseAsync(process.argv);
