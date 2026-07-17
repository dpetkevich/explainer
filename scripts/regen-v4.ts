/**
 * One-off driver: regenerate the four reference papers under the v4.0.0
 * methodology (one insight + one running example) into NEW out dirs, keeping
 * every older version untouched for side-by-side comparison. Runs the exact
 * same code path as the web queue (runGenerationJob), so each row is stamped
 * with the current pedagogy version and shows up in the feed the server serves.
 *
 * Usage: SCENE_CONCURRENCY=6 npx tsx scripts/regen-v4.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env loader so ANTHROPIC_API_KEY can live in the project (mirrors cli.ts).
(() => {
  const envFile = resolve(".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();
import { initDb, createExplainer, getExplainer, deleteExplainer, type SourceKind } from "../src/server/db.js";
import { runGenerationJob } from "../src/server/jobs.js";
import { currentPedagogy } from "../src/lib/pedagogy.js";

interface Spec {
  id: string;
  sourceKind: SourceKind;
  sourceRef: string;
  sourceLabel: string;
  outDir: string;
}

const SPECS: Spec[] = [
  {
    id: "pk-v4",
    sourceKind: "arxiv",
    sourceRef: "https://arxiv.org/abs/2511.13940",
    sourceLabel: "ParallelKittens (arXiv:2511.13940)",
    outDir: "explainers/pk-v4",
  },
  {
    id: "portal-v4",
    sourceKind: "text",
    sourceRef: "fixtures/portal-stp.md",
    sourceLabel: "Solar Thermal Propulsion",
    outDir: "explainers/portal-v4",
  },
  {
    id: "madrona-v4",
    sourceKind: "url",
    sourceRef: "https://madrona-engine.github.io/shacklett_siggraph23.pdf",
    sourceLabel: "Madrona (Shacklett et al., SIGGRAPH 2023)",
    outDir: "explainers/madrona-v4",
  },
  {
    id: "ipw-v4",
    sourceKind: "arxiv",
    sourceRef: "https://arxiv.org/abs/2511.07885",
    sourceLabel: "Intelligence per Watt (arXiv:2511.07885)",
    outDir: "explainers/ipw-v4",
  },
  // v4.1.0 refinements — into fresh dirs (the -v4 versions kept for comparison).
  {
    id: "portal-v41",
    sourceKind: "text",
    sourceRef: "fixtures/portal-stp.md",
    sourceLabel: "Solar Thermal Propulsion",
    outDir: "explainers/portal-v41",
  },
  {
    id: "ipw-v41",
    sourceKind: "arxiv",
    sourceRef: "https://arxiv.org/abs/2511.07885",
    sourceLabel: "Intelligence per Watt (arXiv:2511.07885)",
    outDir: "explainers/ipw-v41",
  },
  {
    id: "quantum-v41",
    sourceKind: "arxiv",
    sourceRef: "https://arxiv.org/abs/2603.28627",
    sourceLabel: "Shor's algorithm with reconfigurable atomic qubits (arXiv:2603.28627)",
    outDir: "explainers/quantum-v41",
  },
];

// Optional id filter: `npx tsx scripts/regen-v4.ts portal-v41` runs only that spec.
const ONLY = new Set(process.argv.slice(2));

const POOL = Math.max(1, Number(process.env.GEN_POOL ?? "2"));

async function main(): Promise<void> {
  console.log(`[regen-v4] pedagogy ${currentPedagogy().version} — ${currentPedagogy().label}`);
  await initDb();

  // Idempotent: skip specs already finished, and reset the rest to a clean
  // queued row. (Out dirs are cache-keyed by input, so kept artifacts resume;
  // changed prompts regen.) A rerun after an interruption thus only picks up
  // what didn't finish.
  const todo: Spec[] = [];
  for (const s of SPECS) {
    if (ONLY.size > 0 && !ONLY.has(s.id)) continue;
    const existing = await getExplainer(s.id);
    if (existing?.status === "done") {
      console.log(`[regen-v4] skipping ${s.id} — already done (${existing.scenes_passed}/${existing.scenes_total})`);
      continue;
    }
    todo.push(s);
  }
  for (const s of todo) await deleteExplainer(s.id);

  const rows = [];
  for (const s of todo) {
    rows.push(await createExplainer({ id: s.id, sourceKind: s.sourceKind, sourceRef: s.sourceRef, sourceLabel: s.sourceLabel, outDir: s.outDir }));
  }

  // Run with a small pool so heavy pipelines don't thrash the rate limiter.
  let next = 0;
  const results: { id: string; ok: boolean; error?: string }[] = [];
  async function worker(): Promise<void> {
    while (next < rows.length) {
      const row = rows[next++]!;
      console.log(`[regen-v4] starting ${row.id}`);
      const t0 = Date.now();
      await runGenerationJob(row); // swallows its own errors -> marks the row failed
      const after = await getExplainer(row.id);
      const mins = ((Date.now() - t0) / 1000 / 60).toFixed(1);
      if (after?.status === "done") {
        console.log(`[regen-v4] finished ${row.id} in ${mins}min (${after.scenes_passed}/${after.scenes_total} scenes)`);
        results.push({ id: row.id, ok: true });
      } else {
        console.log(`[regen-v4] FAILED ${row.id} after ${mins}min: ${after?.error ?? "unknown"}`);
        results.push({ id: row.id, ok: false, error: after?.error ?? "unknown" });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, rows.length) }, () => worker()));

  console.log("[regen-v4] summary:");
  for (const r of results) console.log(`  ${r.ok ? "OK " : "ERR"} ${r.id}${r.error ? ` — ${r.error}` : ""}`);
}

main().catch((err) => {
  console.error("[regen-v4] fatal:", err);
  process.exit(1);
});
