#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { AudienceProfileSchema, type Storyboard } from "./lib/schemas.js";
import { stripMath } from "./lib/mathml.js";
import { StageError, reportError, info } from "./lib/log.js";
import { paths, arxivId, detectInputKind, type Ctx, type InputKind } from "./lib/context.js";
import { runIngest } from "./stages/ingest.js";
import { runStoryboard } from "./stages/storyboard.js";
import { runScenePipeline } from "./stages/pipeline.js";
import { runAssemble } from "./stages/assemble.js";
import { initTimings, recordSpan } from "./lib/timings.js";

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

function slugify(input: string, kind: InputKind): string {
  let base: string;
  if (kind === "arxiv") {
    base = `arxiv-${arxivId(input)}`;
  } else if (kind === "url") {
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
  recordSpan(`stage:${stage}`, t0);
  return result;
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
      if (inputKind !== "url" && inputKind !== "arxiv" && !existsSync(input)) {
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
      initTimings(ctx.workDir);

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
