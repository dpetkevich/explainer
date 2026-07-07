#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { AudienceProfileSchema } from "./lib/schemas.js";
import { StageError, reportError, info } from "./lib/log.js";
import type { Ctx, InputKind } from "./lib/context.js";
import { runIngest } from "./stages/ingest.js";
import { runStoryboard } from "./stages/storyboard.js";
import { runScenes } from "./stages/scenes.js";
import { runQa } from "./stages/qa.js";
import { runAssemble } from "./stages/assemble.js";

const STAGES = ["ingest", "storyboard", "scenes", "qa", "assemble"] as const;
type StageName = (typeof STAGES)[number];

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

const program = new Command();
program
  .name("explain-it")
  .description("Turn a scientific paper (PDF) or technical article (URL) into an interactive HTML explainer")
  .argument("<input>", "path to a PDF (or .md/.txt), or an http(s) URL")
  .option("--out <dir>", "output directory (default: ./explainers/<slug>/)")
  .option("--audience <file>", "audience profile JSON", "./profiles/default.json")
  .option("--max-scenes <n>", "cap on scenes", "5")
  .option("--stage <name>", `run up to a stage: ${STAGES.join(" | ")}`, "assemble")
  .option("--scene <id>", "regenerate a single scene by id, then re-run qa + assemble")
  .option("--force", "ignore cache for the requested stage(s)", false)
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
      const audienceRaw = readFileSync(audiencePath, "utf8");
      const audience = AudienceProfileSchema.parse(JSON.parse(audienceRaw));

      const outDir = resolve(opts.out ?? join("explainers", slugify(input, inputKind)));
      const ctx: Ctx = {
        input,
        inputKind,
        outDir,
        workDir: join(outDir, "work"),
        audience,
        audienceRaw: JSON.stringify(audience, null, 2),
        maxScenes: parseInt(opts.maxScenes, 10),
        force: Boolean(opts.force),
        onlyScene: opts.scene,
      };
      if (!Number.isInteger(ctx.maxScenes) || ctx.maxScenes < 1) {
        throw new StageError("cli", `--max-scenes must be a positive integer, got "${opts.maxScenes}"`);
      }
      mkdirSync(ctx.workDir, { recursive: true });

      // --scene implies running scenes → qa → assemble for that scene, forced.
      const run = (stage: StageName) =>
        targetIdx >= STAGES.indexOf(stage) &&
        (!ctx.onlyScene || ["scenes", "qa", "assemble"].includes(stage));

      // With --scene, upstream artifacts must already exist (never force-refetch them).
      const upstreamCtx: Ctx = ctx.onlyScene ? { ...ctx, force: false } : ctx;

      const conceptMap = await runIngest(upstreamCtx);
      if (targetIdx < 1) return done(ctx, opts.open, null);

      const storyboard = await runStoryboard(upstreamCtx, conceptMap);
      if (targetIdx < 2) return done(ctx, opts.open, null);

      if (run("scenes")) await runScenes(ctx, storyboard);
      if (targetIdx < 3) return done(ctx, opts.open, null);

      const qa = run("qa") ? await runQa(ctx, storyboard) : { scenes: [] };
      if (targetIdx < 4) return done(ctx, opts.open, null);

      const outPath = runAssemble(ctx, conceptMap, storyboard, qa);
      return done(ctx, opts.open, outPath);
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

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
