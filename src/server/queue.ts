/**
 * In-process generation queue with bounded concurrency. Each generation
 * already fans out to 4 internal scene workers plus a headless browser, so the
 * default concurrency is 1 (override with GEN_CONCURRENCY). Jobs are the
 * explainer rows themselves; the queue just decides when each one runs.
 */
import { runGenerationJob } from "./jobs.js";
import { listQueued, type ExplainerRow } from "./db.js";
import { info, warn } from "../lib/log.js";

const CONCURRENCY = Math.max(1, Number(process.env.GEN_CONCURRENCY ?? "1"));

const waiting: ExplainerRow[] = [];
let active = 0;

function pump(): void {
  while (active < CONCURRENCY && waiting.length > 0) {
    const row = waiting.shift()!;
    active += 1;
    info("queue", `starting generation ${row.id} (${active} active, ${waiting.length} waiting)`);
    runGenerationJob(row)
      .catch((err) => warn("queue", `job ${row.id} threw unexpectedly: ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

export function enqueue(row: ExplainerRow): void {
  waiting.push(row);
  pump();
}

/** On boot, re-enqueue any jobs that were still "queued" from a prior process. */
export function resumeQueued(): void {
  const queued = listQueued();
  if (queued.length > 0) info("queue", `resuming ${queued.length} queued job(s)`);
  for (const row of queued) waiting.push(row);
  pump();
}

export function queueDepth(): { active: number; waiting: number } {
  return { active, waiting: waiting.length };
}
