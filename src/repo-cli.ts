#!/usr/bin/env node
/**
 * repo-cli — the collaboration surface for published explanations.
 *
 * An explanation repo contains ONLY the files a contributor edits:
 *   storyboard.json, audience.json, paper.json, endorsements.json,
 *   scenes.lock.json, README/CONTRIBUTING/CODEOWNERS/workflow.
 * Generated scene HTML lives in a GitHub release asset bundle pinned by the
 * lockfile. CI runs `validate` → `fetch` → `assemble` with NO model keys;
 * regeneration is always a maintainer-local act (`regen`) with their own key.
 */
import { Command } from "commander";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  StoryboardSchema,
  AudienceProfileSchema,
  ConceptMapSchema,
  EndorsementsSchema,
  PaperMetaSchema,
  type ConceptMap,
  type Storyboard,
  type PaperMeta,
} from "./lib/schemas.js";
import { sceneInputHash, sceneContract } from "./stages/scenes.js";
import { stageHash, recordHash } from "./lib/cache.js";
import { loadPromptRaw } from "./lib/prompts.js";
import { MODELS } from "./lib/anthropic.js";
import { runScenePipeline } from "./stages/pipeline.js";
import { runAssemble } from "./stages/assemble.js";
import { paths, type Ctx } from "./lib/context.js";
import { StageError, reportError, info, warn } from "./lib/log.js";
import type { QaSummary, SceneResult } from "./stages/qa.js";
import {
  LOCKFILE,
  BUNDLE_ASSET,
  readLock,
  writeLock,
  contractHash,
  packBundle,
  unpackBundle,
  sha256File,
  bundleTag,
  type SceneLock,
} from "./lib/lockfile.js";

const TOOL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCENES_WORKDIR = ".scenes"; // gitignored working area holding fetched/regenerated artifacts

// Minimal .env loader (same behavior as the main CLI) so `regen` finds the key.
(() => {
  const envFile = resolve(TOOL_ROOT, ".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();

/** Ctx whose generated artifacts live in <repo>/.scenes; outputs (explainer.html) in <repo>. */
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
    workDir: join(abs, SCENES_WORKDIR),
    audience,
    audienceRaw: JSON.stringify(audience, null, 2),
    force: false,
  };
}

function loadRepoStoryboard(dir: string): Storyboard {
  return StoryboardSchema.parse(JSON.parse(readFileSync(join(dir, "storyboard.json"), "utf8")));
}

function loadPaperMeta(dir: string): PaperMeta {
  return PaperMetaSchema.parse(JSON.parse(readFileSync(join(dir, "paper.json"), "utf8")));
}

/** Minimal ConceptMap stand-in for assemble (which only reads .paper). */
function conceptMapFromPaperMeta(dir: string): ConceptMap {
  const meta = loadPaperMeta(dir);
  return {
    paper: { title: meta.title, authors: meta.authors, oneSentenceClaim: meta.oneSentenceClaim },
    prerequisites: [],
    concepts: [{ id: "paper", name: meta.title, whyItMatters: meta.oneSentenceClaim, coreMechanism: meta.oneSentenceClaim }],
  };
}

function qaSummaryFromLock(lock: SceneLock, storyboard: Storyboard): QaSummary {
  const scenes: SceneResult[] = storyboard.scenes.map((s) => {
    const entry = lock.scenes[s.id];
    if (!entry) return { id: s.id, status: "fail", attempts: 0 };
    return { id: s.id, status: entry.qa.status, attempts: entry.qa.attempts };
  });
  return { scenes };
}

interface SceneStatus {
  id: string;
  state: "in-sync" | "spec-changed" | "missing-from-lock" | "qa-failed";
}

function sceneStatuses(ctx: Ctx, storyboard: Storyboard, lock: SceneLock): SceneStatus[] {
  return storyboard.scenes.map((scene) => {
    const entry = lock.scenes[scene.id];
    if (!entry) return { id: scene.id, state: "missing-from-lock" as const };
    if (entry.contractHash !== contractHash(ctx, scene)) return { id: scene.id, state: "spec-changed" as const };
    if (entry.qa.status !== "pass") return { id: scene.id, state: "qa-failed" as const };
    return { id: scene.id, state: "in-sync" as const };
  });
}

function buildLock(ctx: Ctx, storyboard: Storyboard, bundleSha: string, qa: QaSummary): SceneLock {
  const byId = new Map(qa.scenes.map((s) => [s.id, s]));
  const scenes: SceneLock["scenes"] = {};
  for (const scene of storyboard.scenes) {
    const result = byId.get(scene.id);
    scenes[scene.id] = {
      contractHash: contractHash(ctx, scene),
      qa: { status: result?.status ?? "fail", attempts: result?.attempts ?? 0 },
    };
  }
  return { bundle: { tag: bundleTag(bundleSha), asset: BUNDLE_ASSET, sha256: bundleSha }, scenes };
}

function fetchBundle(dir: string): void {
  const meta = loadPaperMeta(dir);
  const lock = readLock(dir);
  const dest = join(dir, SCENES_WORKDIR);
  const bundleFile = join(dest, BUNDLE_ASSET);
  mkdirSync(dest, { recursive: true });
  if (existsSync(bundleFile) && sha256File(bundleFile) === lock.bundle.sha256) {
    info("repo", "bundle already fetched and verified — skipping download");
  } else {
    const url = `https://github.com/${meta.org}/${meta.slug}/releases/download/${lock.bundle.tag}/${lock.bundle.asset}`;
    info("repo", `fetching ${url}`);
    execFileSync("curl", ["-fsSL", "-o", bundleFile, url]);
    const got = sha256File(bundleFile);
    if (got !== lock.bundle.sha256) {
      rmSync(bundleFile);
      throw new StageError("repo", `bundle sha256 mismatch: expected ${lock.bundle.sha256}, got ${got}`);
    }
  }
  unpackBundle(bundleFile, dest);
  info("repo", `bundle verified and extracted to ${dest}/scenes`);
}

/** Write local-cache hash/report files for in-sync scenes so regen skips them. */
function synthesizeFreshness(ctx: Ctx, storyboard: Storyboard, lock: SceneLock): void {
  mkdirSync(paths.qaDir(ctx), { recursive: true });
  for (const scene of storyboard.scenes) {
    const entry = lock.scenes[scene.id];
    const htmlPath = paths.sceneHtml(ctx, scene.id);
    if (!entry || entry.qa.status !== "pass" || !existsSync(htmlPath)) continue;
    if (entry.contractHash !== contractHash(ctx, scene)) continue;
    recordHash(paths.sceneHash(ctx, scene.id), sceneInputHash(ctx, scene));
    const result: SceneResult = { id: scene.id, status: "pass", attempts: entry.qa.attempts };
    writeFileSync(paths.qaReport(ctx, scene.id), JSON.stringify(result, null, 2));
    recordHash(
      paths.qaHash(ctx, scene.id),
      stageHash({
        artifacts: [readFileSync(htmlPath, "utf8"), sceneContract(scene)],
        prompt: loadPromptRaw("review") + loadPromptRaw("repair"),
        model: MODELS.review,
      })
    );
  }
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

function writeRepoScaffolding(out: string, vars: Record<string, string>): void {
  // Root contains ONLY editor-edited files; all infrastructure lives in .github/
  // (GitHub officially renders README/CONTRIBUTING/CODEOWNERS from there).
  mkdirSync(join(out, ".github", "workflows"), { recursive: true });
  writeFileSync(join(out, ".github", "workflows", "build.yml"), instantiateTemplate("build.yml", vars));
  writeFileSync(join(out, ".github", "CODEOWNERS"), instantiateTemplate("CODEOWNERS", vars));
  writeFileSync(join(out, ".github", "README.md"), instantiateTemplate("README.md.tmpl", vars));
  writeFileSync(join(out, ".github", "CONTRIBUTING.md"), instantiateTemplate("CONTRIBUTING.md", vars));
  writeFileSync(join(out, ".gitignore"), `${SCENES_WORKDIR}/\nexplainer.html\n${BUNDLE_ASSET}\n.DS_Store\n`);
}

const program = new Command();
program.name("repo-cli").description("Publish and maintain explanation repos (GitHub-as-backend collaboration)");

program
  .command("export")
  .description("Emit a minimal publishable explanation repo (+ scenes.tar.gz bundle) from a pipeline output dir")
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

      // Editable tree
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "storyboard.json"), JSON.stringify(storyboard, null, 2) + "\n");
      writeFileSync(join(out, "audience.json"), JSON.stringify(audience, null, 2) + "\n");
      const paperMeta = PaperMetaSchema.parse({
        title: conceptMap.paper.title,
        authors: conceptMap.paper.authors,
        oneSentenceClaim: conceptMap.paper.oneSentenceClaim,
        source: opts.source,
        org: opts.org,
        slug: opts.slug,
        audienceName: opts.audienceName ?? audience.background,
        tool: { repo: opts.toolRepo, ref: opts.toolRef },
      });
      writeFileSync(join(out, "paper.json"), JSON.stringify(paperMeta, null, 2) + "\n");
      if (!existsSync(join(out, "endorsements.json"))) writeFileSync(join(out, "endorsements.json"), "[]\n");
      writeRepoScaffolding(out, {
        ORG: opts.org,
        SLUG: opts.slug,
        TOOL_REPO: opts.toolRepo,
        TOOL_REF: opts.toolRef,
        TITLE: conceptMap.paper.title,
        SOURCE: opts.source,
      });

      // Artifact bundle (not committed) + lockfile (committed)
      const scenesDir = join(out, SCENES_WORKDIR);
      mkdirSync(join(scenesDir, "scenes"), { recursive: true });
      const qaResults: SceneResult[] = [];
      for (const scene of storyboard.scenes) {
        const html = join(workDir, "scenes", `${scene.id}.html`);
        const report = join(workDir, "qa", `${scene.id}.report.json`);
        if (!existsSync(html)) throw new StageError("repo", `missing scene HTML: ${html}`);
        copyFileSync(html, join(scenesDir, "scenes", `${scene.id}.html`));
        qaResults.push(
          existsSync(report)
            ? (JSON.parse(readFileSync(report, "utf8")) as SceneResult)
            : { id: scene.id, status: "fail", attempts: 0 }
        );
      }
      const bundleFile = join(out, BUNDLE_ASSET);
      const sha = packBundle(scenesDir, bundleFile);
      const ctx = repoCtx(out);
      const lock = buildLock(ctx, storyboard, sha, { scenes: qaResults });
      writeLock(out, lock);

      runAssemble(ctx, conceptMapFromPaperMeta(out), storyboard, qaSummaryFromLock(lock, storyboard));
      info("repo", `exported ${storyboard.scenes.length} scenes → ${out}`);
      info("repo", `bundle: ${BUNDLE_ASSET} (${sha.slice(0, 12)}…) — publish with:`);
      info("repo", `  gh release create ${lock.bundle.tag} ${BUNDLE_ASSET} -R ${opts.org}/${opts.slug} --title "${lock.bundle.tag}" --notes "scene artifact bundle"`);
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

program
  .command("validate")
  .description("Schema-validate the repo and check the lockfile against the storyboard specs (no downloads)")
  .argument("<dir>", "explanation repo directory")
  .action((dir: string) => {
    try {
      const ctx = repoCtx(dir);
      const storyboard = loadRepoStoryboard(ctx.outDir);
      loadPaperMeta(ctx.outDir);
      EndorsementsSchema.parse(JSON.parse(readFileSync(join(ctx.outDir, "endorsements.json"), "utf8")));
      const lock = readLock(ctx.outDir);

      const statuses = sceneStatuses(ctx, storyboard, lock);
      for (const s of statuses) console.log(`${s.state === "in-sync" ? "✓" : "✗"} ${s.id}: ${s.state}`);
      for (const id of Object.keys(lock.scenes)) {
        if (!storyboard.scenes.some((s) => s.id === id)) warn("repo", `lockfile entry for removed scene: ${id}`);
      }
      const stale = statuses.filter((s) => s.state !== "in-sync");
      if (stale.length > 0) {
        console.error(
          `\n✗ regeneration needed for ${stale.length} scene(s): ${stale.map((s) => s.id).join(", ")}\n` +
            `  A maintainer must run locally (uses their own ANTHROPIC_API_KEY + gh auth):\n` +
            `    npx tsx src/repo-cli.ts regen <path-to-this-repo>\n` +
            `  which regenerates stale scenes, uploads a new artifact bundle release, and updates ${LOCKFILE}.`
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
  .command("fetch")
  .description("Download the pinned artifact bundle release, verify sha256, extract to .scenes/")
  .argument("<dir>", "explanation repo directory")
  .action((dir: string) => {
    try {
      fetchBundle(resolve(dir));
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

program
  .command("assemble")
  .description("Assemble explainer.html from storyboard + fetched bundle (no model calls)")
  .argument("<dir>", "explanation repo directory")
  .action((dir: string) => {
    try {
      const ctx = repoCtx(dir);
      const storyboard = loadRepoStoryboard(ctx.outDir);
      if (!existsSync(join(ctx.workDir, "scenes"))) {
        throw new StageError("repo", `no fetched scenes at ${ctx.workDir}/scenes — run \`fetch\` first`);
      }
      const lock = readLock(ctx.outDir);
      runAssemble(ctx, conceptMapFromPaperMeta(ctx.outDir), storyboard, qaSummaryFromLock(lock, storyboard));
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

program
  .command("regen")
  .description("Maintainer-local: regenerate stale scenes with YOUR key, upload a new bundle release, update the lockfile")
  .argument("<dir>", "explanation repo directory")
  .option("--scene <id>", "force-regenerate one scene by id")
  .option("--no-release", "skip the gh release upload (bundle + lockfile still written)")
  .action(async (dir: string, opts) => {
    try {
      const abs = resolve(dir);
      const ctx = repoCtx(abs);
      const storyboard = loadRepoStoryboard(abs);
      const lock = readLock(abs);

      fetchBundle(abs);
      synthesizeFreshness(ctx, storyboard, lock);
      if (opts.scene) ctx.onlyScene = opts.scene;

      const stale = sceneStatuses(ctx, storyboard, lock).filter((s) => s.state !== "in-sync");
      info("repo", stale.length ? `regenerating: ${stale.map((s) => s.id).join(", ")}` : "all scenes in-sync");
      const qa = await runScenePipeline(ctx, storyboard, true);

      const bundleFile = join(abs, BUNDLE_ASSET);
      const sha = packBundle(ctx.workDir, bundleFile);
      const newLock = buildLock(ctx, storyboard, sha, qa);
      writeLock(abs, newLock);
      runAssemble(ctx, conceptMapFromPaperMeta(abs), storyboard, qaSummaryFromLock(newLock, storyboard));

      if (opts.release !== false) {
        const meta = loadPaperMeta(abs);
        execFileSync(
          "gh",
          ["release", "create", newLock.bundle.tag, bundleFile, "-R", `${meta.org}/${meta.slug}`,
           "--title", newLock.bundle.tag, "--notes", "scene artifact bundle (maintainer regen)"],
          { stdio: "inherit" }
        );
      }
      info("repo", `regen complete — commit ${LOCKFILE} (and storyboard.json if you edited it), then push`);
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

program
  .command("rehash")
  .description("Maintainer-local: re-record lockfile contract hashes for kept graphics (hash-formula migrations)")
  .argument("<dir>", "explanation repo directory")
  .action((dir: string) => {
    try {
      const ctx = repoCtx(dir);
      const storyboard = loadRepoStoryboard(ctx.outDir);
      const lock = readLock(ctx.outDir);
      let kept = 0;
      for (const scene of storyboard.scenes) {
        const entry = lock.scenes[scene.id];
        if (!entry || entry.qa.status !== "pass") continue;
        entry.contractHash = contractHash(ctx, scene);
        kept++;
      }
      writeLock(ctx.outDir, lock);
      info("repo", `rehash: ${kept} lockfile entries re-recorded`);
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
