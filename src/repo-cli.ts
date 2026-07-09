#!/usr/bin/env node
/**
 * repo-cli — the collaboration surface for published explanations.
 *
 * An explanation lives in its own GitHub repo (storyboard.json + committed
 * scene artifacts). CI runs `validate` + `assemble` with NO model keys;
 * regeneration is always a maintainer-local act (`regen`) with their own key.
 */
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  StoryboardSchema,
  AudienceProfileSchema,
  ConceptMapSchema,
  EndorsementsSchema,
  PaperMetaSchema,
  type ConceptMap,
  type Storyboard,
} from "./lib/schemas.js";
import { sceneInputHash } from "./stages/scenes.js";
import { runScenePipeline } from "./stages/pipeline.js";
import { runAssemble } from "./stages/assemble.js";
import { paths, type Ctx } from "./lib/context.js";
import { StageError, reportError, info, warn } from "./lib/log.js";
import type { QaSummary, SceneResult } from "./stages/qa.js";

const TOOL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader (same behavior as the main CLI) so `regen` finds the key.
(() => {
  const envFile = resolve(TOOL_ROOT, ".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();

/** Build a Ctx whose work products all live directly in the explanation repo dir. */
function repoCtx(dir: string): Ctx {
  const abs = resolve(dir);
  const audienceFile = join(abs, "audience.json");
  if (!existsSync(audienceFile)) {
    throw new StageError("repo", `not an explanation repo (missing audience.json): ${abs}`);
  }
  const audience = AudienceProfileSchema.parse(JSON.parse(readFileSync(audienceFile, "utf8")));
  return {
    input: abs,
    inputKind: "text",
    outDir: abs,
    workDir: abs,
    audience,
    audienceRaw: JSON.stringify(audience, null, 2),
    force: false,
  };
}

function loadStoryboard(ctx: Ctx): Storyboard {
  return StoryboardSchema.parse(JSON.parse(readFileSync(paths.storyboard(ctx), "utf8")));
}

/** Minimal ConceptMap stand-in for assemble (which only reads .paper). */
function conceptMapFromPaperMeta(dir: string): ConceptMap {
  const meta = PaperMetaSchema.parse(JSON.parse(readFileSync(join(dir, "paper.json"), "utf8")));
  return {
    paper: { title: meta.title, authors: meta.authors, oneSentenceClaim: meta.oneSentenceClaim },
    prerequisites: [],
    concepts: [{ id: "paper", name: meta.title, whyItMatters: meta.oneSentenceClaim, coreMechanism: meta.oneSentenceClaim }],
  };
}

function qaSummaryFromReports(ctx: Ctx, storyboard: Storyboard): QaSummary {
  const scenes: SceneResult[] = storyboard.scenes.map((s) => {
    const reportPath = paths.qaReport(ctx, s.id);
    if (!existsSync(reportPath)) return { id: s.id, status: "fail", attempts: 0 };
    return JSON.parse(readFileSync(reportPath, "utf8")) as SceneResult;
  });
  return { scenes };
}

interface SceneStatus {
  id: string;
  state: "in-sync" | "spec-changed" | "missing-html" | "missing-hash" | "qa-failed" | "missing-qa";
}

function sceneStatuses(ctx: Ctx, storyboard: Storyboard): SceneStatus[] {
  return storyboard.scenes.map((scene) => {
    const htmlPath = paths.sceneHtml(ctx, scene.id);
    const hashPath = paths.sceneHash(ctx, scene.id);
    const reportPath = paths.qaReport(ctx, scene.id);
    if (!existsSync(htmlPath)) return { id: scene.id, state: "missing-html" as const };
    if (!existsSync(hashPath)) return { id: scene.id, state: "missing-hash" as const };
    if (readFileSync(hashPath, "utf8").trim() !== sceneInputHash(ctx, scene)) {
      return { id: scene.id, state: "spec-changed" as const };
    }
    if (!existsSync(reportPath)) return { id: scene.id, state: "missing-qa" as const };
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as SceneResult;
    if (report.status !== "pass") return { id: scene.id, state: "qa-failed" as const };
    return { id: scene.id, state: "in-sync" as const };
  });
}

function instantiateTemplate(name: string, vars: Record<string, string>): string {
  let text = readFileSync(join(TOOL_ROOT, "templates", "repo", name), "utf8");
  for (const [key, value] of Object.entries(vars)) {
    text = text.replaceAll(`__${key}__`, value);
  }
  const leftover = text.match(/__[A-Z_]+__/);
  if (leftover) throw new StageError("repo", `template ${name}: unfilled placeholder ${leftover[0]}`);
  return text;
}

const program = new Command();
program.name("repo-cli").description("Publish and maintain explanation repos (GitHub-as-backend collaboration)");

program
  .command("export")
  .description("Emit a publishable explanation repo from a pipeline output directory")
  .argument("<explainerDir>", "pipeline output dir (contains work/)")
  .argument("<outDir>", "destination repo directory")
  .requiredOption("--org <org>", "GitHub org the repo will live under")
  .requiredOption("--slug <slug>", "repo name / slug")
  .requiredOption("--source <url>", "paper source (arXiv or article URL)")
  .option("--audience <file>", "audience profile used for this explanation", "./profiles/default.json")
  .option("--audience-name <name>", "human name of the audience profile")
  .option("--tool-repo <owner/name>", "tool repo for CI checkout", "dpetkevich/explainer")
  .option("--tool-ref <ref>", "tool ref for CI checkout", "main")
  .action((explainerDir: string, outDir: string, opts) => {
    try {
      const workDir = join(resolve(explainerDir), "work");
      const out = resolve(outDir);
      const storyboard = StoryboardSchema.parse(JSON.parse(readFileSync(join(workDir, "storyboard.json"), "utf8")));
      const conceptMap = ConceptMapSchema.parse(JSON.parse(readFileSync(join(workDir, "concept-map.json"), "utf8")));
      const audience = AudienceProfileSchema.parse(JSON.parse(readFileSync(resolve(opts.audience), "utf8")));

      mkdirSync(join(out, "scenes"), { recursive: true });
      mkdirSync(join(out, "qa"), { recursive: true });
      mkdirSync(join(out, ".github", "workflows"), { recursive: true });

      writeFileSync(join(out, "storyboard.json"), JSON.stringify(storyboard, null, 2) + "\n");
      writeFileSync(join(out, "audience.json"), JSON.stringify(audience, null, 2) + "\n");
      const paperMeta = {
        title: conceptMap.paper.title,
        authors: conceptMap.paper.authors,
        oneSentenceClaim: conceptMap.paper.oneSentenceClaim,
        source: opts.source,
        slug: opts.slug,
        audienceName: opts.audienceName ?? audience.background,
        tool: { repo: opts.toolRepo, ref: opts.toolRef },
      };
      writeFileSync(join(out, "paper.json"), JSON.stringify(PaperMetaSchema.parse(paperMeta), null, 2) + "\n");
      if (!existsSync(join(out, "endorsements.json"))) {
        writeFileSync(join(out, "endorsements.json"), "[]\n");
      }

      // Committed artifacts: scene HTML + input hashes + QA verdicts (no PNGs).
      for (const scene of storyboard.scenes) {
        for (const [from, to] of [
          [join(workDir, "scenes", `${scene.id}.html`), join(out, "scenes", `${scene.id}.html`)],
          [join(workDir, "scenes", `${scene.id}.hash`), join(out, "scenes", `${scene.id}.hash`)],
          [join(workDir, "qa", `${scene.id}.report.json`), join(out, "qa", `${scene.id}.report.json`)],
        ] as const) {
          if (!existsSync(from)) throw new StageError("repo", `missing artifact for scene "${scene.id}": ${from}`);
          copyFileSync(from, to);
        }
      }
      if (existsSync(join(workDir, "script.md"))) copyFileSync(join(workDir, "script.md"), join(out, "script.md"));

      const vars = {
        ORG: opts.org,
        SLUG: opts.slug,
        TOOL_REPO: opts.toolRepo,
        TOOL_REF: opts.toolRef,
        TITLE: conceptMap.paper.title,
        SOURCE: opts.source,
      };
      writeFileSync(join(out, ".github", "workflows", "build.yml"), instantiateTemplate("build.yml", vars));
      writeFileSync(join(out, "CODEOWNERS"), instantiateTemplate("CODEOWNERS", vars));
      writeFileSync(join(out, "README.md"), instantiateTemplate("README.md.tmpl", vars));
      writeFileSync(join(out, "CONTRIBUTING.md"), instantiateTemplate("CONTRIBUTING.md", vars));

      // Assemble so the repo ships with a current explainer.html from day one.
      const ctx = repoCtx(out);
      runAssemble(ctx, conceptMapFromPaperMeta(out), storyboard, qaSummaryFromReports(ctx, loadStoryboard(ctx)));
      info("repo", `exported ${storyboard.scenes.length} scenes to ${out}`);
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

program
  .command("validate")
  .description("Schema-validate the repo and check that committed scenes match the storyboard specs")
  .argument("<dir>", "explanation repo directory")
  .action((dir: string) => {
    try {
      const ctx = repoCtx(dir);
      const storyboard = loadStoryboard(ctx);
      PaperMetaSchema.parse(JSON.parse(readFileSync(join(ctx.outDir, "paper.json"), "utf8")));
      EndorsementsSchema.parse(JSON.parse(readFileSync(join(ctx.outDir, "endorsements.json"), "utf8")));

      const statuses = sceneStatuses(ctx, storyboard);
      const stale = statuses.filter((s) => s.state !== "in-sync");
      for (const s of statuses) {
        console.log(`${s.state === "in-sync" ? "✓" : "✗"} ${s.id}: ${s.state}`);
      }
      // Orphaned artifacts (scene removed from storyboard but html still committed) — warn only.
      const known = new Set(storyboard.scenes.map((s) => s.id));
      for (const f of readdirSync(join(ctx.outDir, "scenes"))) {
        const id = f.replace(/\.(html|hash)$/, "");
        if (!known.has(id)) warn("repo", `orphaned artifact (scene not in storyboard): scenes/${f}`);
      }
      if (stale.length > 0) {
        console.error(
          `\n✗ regeneration needed for ${stale.length} scene(s): ${stale.map((s) => s.id).join(", ")}\n` +
            `  A maintainer must run locally (uses their own ANTHROPIC_API_KEY):\n` +
            `    npx tsx src/repo-cli.ts regen <path-to-this-repo>\n` +
            `  and push the updated scenes/, qa/, and explainer.html to this branch.`
        );
        process.exitCode = 1;
        return;
      }
      info("repo", `validate: ${storyboard.scenes.length} scenes in-sync ✓`);
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

program
  .command("assemble")
  .description("Assemble explainer.html from the committed storyboard + scenes (no model calls)")
  .argument("<dir>", "explanation repo directory")
  .action((dir: string) => {
    try {
      const ctx = repoCtx(dir);
      const storyboard = loadStoryboard(ctx);
      runAssemble(ctx, conceptMapFromPaperMeta(ctx.outDir), storyboard, qaSummaryFromReports(ctx, storyboard));
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

program
  .command("regen")
  .description("Maintainer-local: regenerate stale scenes with YOUR API key, re-QA, reassemble")
  .argument("<dir>", "explanation repo directory")
  .option("--scene <id>", "force-regenerate one scene by id")
  .action(async (dir: string, opts) => {
    try {
      const ctx = repoCtx(dir);
      if (opts.scene) ctx.onlyScene = opts.scene;
      const storyboard = loadStoryboard(ctx);
      const before = sceneStatuses(ctx, storyboard).filter((s) => s.state !== "in-sync");
      if (before.length === 0 && !opts.scene) {
        info("repo", "all scenes in-sync — nothing to regenerate");
      } else {
        info("repo", `regenerating: ${opts.scene ?? before.map((s) => s.id).join(", ")}`);
      }
      await runScenePipeline(ctx, storyboard, true);
      runAssemble(ctx, conceptMapFromPaperMeta(ctx.outDir), storyboard, qaSummaryFromReports(ctx, storyboard));
      info("repo", "regen complete — review the diff, then commit scenes/, qa/, and explainer.html");
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
