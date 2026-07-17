/**
 * Deterministically reassemble every finished explainer from its cached work
 * artifacts (concept-map + storyboard + qa summary + scene HTML). No model
 * calls — used to roll out presentation-only changes in assemble.ts / the
 * template to already-generated explainers.
 *
 * Usage: npx tsx scripts/reassemble.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConceptMapSchema, StoryboardSchema } from "../src/lib/schemas.js";
import { paths, type Ctx } from "../src/lib/context.js";
import { runAssemble } from "../src/stages/assemble.js";
import type { QaSummary } from "../src/stages/qa.js";
import { listExplainers } from "../src/server/db.js";

// Minimal .env loader so POSTGRES_URL is available (mirrors cli.ts).
(() => {
  const envFile = resolve(".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();

const rows = (await listExplainers()).filter((r) => r.status === "done");

let ok = 0;
let skipped = 0;
for (const row of rows) {
  const ctx = { outDir: row.out_dir, workDir: join(row.out_dir, "work"), inputKind: "text", input: "" } as Ctx;
  try {
    const cm = paths.conceptMap(ctx);
    const sb = paths.storyboard(ctx);
    const qs = paths.qaSummary(ctx);
    if (!existsSync(cm) || !existsSync(sb) || !existsSync(qs)) {
      console.log(`skip ${row.id} — missing work artifacts`);
      skipped++;
      continue;
    }
    const conceptMap = ConceptMapSchema.parse(JSON.parse(readFileSync(cm, "utf8")));
    const board = StoryboardSchema.parse(JSON.parse(readFileSync(sb, "utf8")));
    const qa = JSON.parse(readFileSync(qs, "utf8")) as QaSummary;
    runAssemble(ctx, conceptMap, board, qa);
    ok++;
  } catch (err) {
    console.log(`skip ${row.id} — ${err instanceof Error ? err.message : String(err)}`);
    skipped++;
  }
}
console.log(`\nreassembled ${ok} explainer(s), skipped ${skipped}`);
