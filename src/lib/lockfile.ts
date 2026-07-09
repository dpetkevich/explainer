/**
 * scenes.lock.json — the single committed record of an explanation repo's
 * generated artifacts. The scene HTML itself lives in a GitHub release asset
 * bundle (scenes.tar.gz) pinned here by sha256, so the repo tree contains only
 * the files a contributor edits.
 *
 * Lockfile contract hashes are deliberately prompt/model-agnostic (unlike the
 * local pipeline cache): published artifacts stay valid when the tool's prompts
 * evolve; adopting new prompts for an existing explanation is a deliberate
 * maintainer regen, not an implicit invalidation.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sceneContract } from "../stages/scenes.js";
import { stageHash } from "./cache.js";
import type { Ctx } from "./context.js";
import type { StoryboardScene } from "./schemas.js";

export const SceneLockSchema = z.object({
  bundle: z.object({
    tag: z.string().min(1),
    asset: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  scenes: z.record(
    z.string(),
    z.object({
      contractHash: z.string().min(1),
      qa: z.object({
        status: z.enum(["pass", "fail"]),
        attempts: z.number().int().nonnegative(),
      }),
    })
  ),
});
export type SceneLock = z.infer<typeof SceneLockSchema>;

export const LOCKFILE = "scenes.lock.json";
export const BUNDLE_ASSET = "scenes.tar.gz";

/** Prompt/model-agnostic hash of a scene's graphic-shaping fields + audience. */
export function contractHash(ctx: Ctx, scene: StoryboardScene): string {
  return stageHash({ artifacts: [sceneContract(scene), ctx.audienceRaw], prompt: "", model: "" });
}

export function readLock(dir: string): SceneLock {
  return SceneLockSchema.parse(JSON.parse(readFileSync(join(dir, LOCKFILE), "utf8")));
}

export function writeLock(dir: string, lock: SceneLock): void {
  writeFileSync(join(dir, LOCKFILE), JSON.stringify(SceneLockSchema.parse(lock), null, 2) + "\n");
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function bundleTag(sha: string): string {
  return `scenes-${sha.slice(0, 12)}`;
}

/** Pack <srcDir>/scenes/*.html into <outFile>; returns the bundle sha256. */
export function packBundle(srcDir: string, outFile: string): string {
  execFileSync("tar", ["-czf", outFile, "-C", srcDir, "scenes"]);
  return sha256File(outFile);
}

/** Extract a bundle into destDir (creating destDir/scenes/). */
export function unpackBundle(bundleFile: string, destDir: string): void {
  execFileSync("tar", ["-xzf", bundleFile, "-C", destDir]);
}
