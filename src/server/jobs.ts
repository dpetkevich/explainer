/**
 * Runs one generation end-to-end for an explainer record. Imports the pipeline
 * stages directly (so the CLI's script-review gate never applies) and threads a
 * progress sink that updates the DB row and fans events out to SSE subscribers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runIngest } from "../stages/ingest.js";
import { runStoryboard } from "../stages/storyboard.js";
import { runScenePipeline } from "../stages/pipeline.js";
import { runAssemble } from "../stages/assemble.js";
import { AudienceProfileSchema, type AudienceProfile } from "../lib/schemas.js";
import { currentPedagogy } from "../lib/pedagogy.js";
import { RefusalError } from "../lib/anthropic.js";
import type { Ctx } from "../lib/context.js";
import type { ProgressEvent } from "../lib/progress.js";
import { updateExplainer, type ExplainerRow } from "./db.js";
import { publish } from "./sse.js";

const DEFAULT_PROFILE = process.env.AUDIENCE_PROFILE ?? "profiles/default.json";

function loadAudience(): AudienceProfile {
  return AudienceProfileSchema.parse(JSON.parse(readFileSync(DEFAULT_PROFILE, "utf8")));
}

export async function runGenerationJob(row: ExplainerRow): Promise<void> {
  const audience = loadAudience();
  let scenesPassed = 0;

  const onEvent = (e: ProgressEvent): void => {
    switch (e.type) {
      case "stage-start":
        updateExplainer(row.id, { stage: e.stage });
        break;
      case "storyboard-ready":
        updateExplainer(row.id, { title: e.title, scenes_total: e.sceneCount });
        break;
      case "scene-pass":
        scenesPassed += 1;
        updateExplainer(row.id, { scenes_passed: scenesPassed });
        break;
    }
    publish(row.id, e);
  };

  const ctx: Ctx = {
    input: row.source_ref,
    inputKind: row.source_kind,
    outDir: row.out_dir,
    workDir: join(row.out_dir, "work"),
    audience,
    audienceRaw: JSON.stringify(audience, null, 2),
    force: false,
    onEvent,
  };

  updateExplainer(row.id, { status: "running", stage: "ingest", error: null });

  try {
    const conceptMap = await runIngest(ctx);
    updateExplainer(row.id, {
      one_sentence_claim: conceptMap.paper.oneSentenceClaim,
      category: conceptMap.paper.category ?? "Computing",
    });
    const { board } = await runStoryboard(ctx, conceptMap);
    updateExplainer(row.id, { title: board.title, hook: board.hook });
    const qa = await runScenePipeline(ctx, board, true);
    runAssemble(ctx, conceptMap, board, qa);
    updateExplainer(row.id, { status: "done", stage: "assemble", pedagogy_version: currentPedagogy().version });
    publish(row.id, { type: "closed", status: "done" });
  } catch (err) {
    const message =
      err instanceof RefusalError
        ? "generation was declined for this content"
        : err instanceof Error
          ? err.message
          : String(err);
    updateExplainer(row.id, { status: "failed", error: message });
    publish(row.id, { type: "closed", status: "failed", error: message });
  }
}
