/**
 * Regenerate specific scenes of an already-generated explainer WITHOUT touching
 * the storyboard stage — so manual spec edits in work/storyboard.json are used
 * as-is and never overwritten by a storyboard regeneration. (The `--scene` CLI
 * path re-runs the storyboard stage, which cache-misses whenever the prose
 * review has rewritten concept-map.json, regenerating the whole board.)
 *
 * Usage: SCENE_CONCURRENCY=6 npx tsx scripts/regen-scenes.ts <outDir> <sceneId...>
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { AudienceProfileSchema, ConceptMapSchema, StoryboardSchema } from "../src/lib/schemas.js";
import { paths, type Ctx } from "../src/lib/context.js";
import { runScenePipeline } from "../src/stages/pipeline.js";
import { runAssemble } from "../src/stages/assemble.js";
import type { QaSummary } from "../src/stages/qa.js";
import { DATA_DIR } from "../src/server/db.js";

// Minimal .env loader (mirrors cli.ts) so ANTHROPIC_API_KEY is available.
(() => {
  const envFile = resolve(".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();

const AUDIENCE = process.env.AUDIENCE_PROFILE ?? "profiles/default.json";

async function main(): Promise<void> {
  const [outDirArg, ...sceneIds] = process.argv.slice(2);
  if (!outDirArg || sceneIds.length === 0) {
    console.error("usage: npx tsx scripts/regen-scenes.ts <outDir> <sceneId...>");
    process.exit(1);
  }
  const outDir = resolve(outDirArg);
  const audience = AudienceProfileSchema.parse(JSON.parse(readFileSync(AUDIENCE, "utf8")));
  const ctx: Ctx = {
    input: "",
    inputKind: "text",
    outDir,
    workDir: join(outDir, "work"),
    audience,
    audienceRaw: JSON.stringify(audience, null, 2),
    force: true, // force regen + re-QA of the targeted scenes
  };

  const conceptMap = ConceptMapSchema.parse(JSON.parse(readFileSync(paths.conceptMap(ctx), "utf8")));
  const board = StoryboardSchema.parse(JSON.parse(readFileSync(paths.storyboard(ctx), "utf8")));

  // Run one scene at a time so runScenePipeline's onlyScene merge keeps the
  // other scenes' QA results intact; the last call returns the full summary.
  let summary: QaSummary = { scenes: [] };
  for (const id of sceneIds) {
    console.log(`[regen-scenes] regenerating ${id}`);
    summary = await runScenePipeline({ ...ctx, onlyScene: id }, board, true);
  }

  runAssemble(ctx, conceptMap, board, summary);
  const passed = summary.scenes.filter((s) => s.status === "pass").length;
  console.log(`[regen-scenes] ${passed}/${board.scenes.length} scenes passing after regen`);

  // Sync the feed row (matched by out_dir) so the gallery shows the new count.
  const db = new Database(join(DATA_DIR, "explainers.db"));
  const row = db.prepare("SELECT id FROM explainers WHERE out_dir = ?").get(outDirArg) as { id: string } | undefined;
  if (row) {
    db.prepare("UPDATE explainers SET scenes_passed = ?, scenes_total = ?, updated_at = ? WHERE id = ?").run(
      passed,
      board.scenes.length,
      Date.now(),
      row.id
    );
    console.log(`[regen-scenes] updated feed row ${row.id}: ${passed}/${board.scenes.length}`);
  } else {
    console.log(`[regen-scenes] no feed row for out_dir=${outDirArg} (skipped DB update)`);
  }
  db.close();
}

main().catch((err) => {
  console.error("[regen-scenes] fatal:", err);
  process.exit(1);
});
