/**
 * One-off: create the Postgres schema and copy every row from the local SQLite
 * DB (data/explainers.db) into Postgres. Idempotent — explainer rows upsert, and
 * comments/stars/chat_turns are inserted ON CONFLICT DO NOTHING — so it can be
 * re-run to re-sync explainer metadata after new local generation.
 *
 * Usage: POSTGRES_URL=... npx tsx scripts/migrate-to-postgres.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { sql } from "@vercel/postgres";
import { initDb } from "../src/server/db.js";

// Minimal .env loader so POSTGRES_URL can live in the project.
(() => {
  const envFile = resolve(".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();

const SQLITE_PATH = process.env.SQLITE_PATH ?? "data/explainers.db";

async function main(): Promise<void> {
  if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is not set");
  if (!existsSync(SQLITE_PATH)) throw new Error(`local SQLite not found at ${SQLITE_PATH}`);

  console.log(`[migrate] creating Postgres schema`);
  await initDb();

  const lite = new Database(SQLITE_PATH, { readonly: true });
  const rows = <T>(q: string): T[] => lite.prepare(q).all() as T[];

  const explainers = rows<Record<string, unknown>>("SELECT * FROM explainers");
  for (const e of explainers) {
    await sql.query(
      `INSERT INTO explainers
         (id, source_kind, source_ref, source_label, title, one_sentence_claim, hook, status, stage,
          scenes_total, scenes_passed, out_dir, error, stars, category, pedagogy_version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         source_kind=EXCLUDED.source_kind, source_ref=EXCLUDED.source_ref, source_label=EXCLUDED.source_label,
         title=EXCLUDED.title, one_sentence_claim=EXCLUDED.one_sentence_claim, hook=EXCLUDED.hook,
         status=EXCLUDED.status, stage=EXCLUDED.stage, scenes_total=EXCLUDED.scenes_total,
         scenes_passed=EXCLUDED.scenes_passed, out_dir=EXCLUDED.out_dir, error=EXCLUDED.error,
         category=EXCLUDED.category, pedagogy_version=EXCLUDED.pedagogy_version, updated_at=EXCLUDED.updated_at`,
      [
        e.id, e.source_kind, e.source_ref, e.source_label, e.title ?? null, e.one_sentence_claim ?? null,
        e.hook ?? null, e.status, e.stage ?? null, e.scenes_total ?? null, e.scenes_passed ?? null, e.out_dir,
        e.error ?? null, e.stars ?? 0, e.category ?? null, e.pedagogy_version ?? null, e.created_at, e.updated_at,
      ]
    );
  }
  console.log(`[migrate] explainers: ${explainers.length}`);

  const comments = rows<Record<string, unknown>>("SELECT * FROM comments");
  for (const c of comments) {
    await sql.query(
      `INSERT INTO comments (id, explainer_id, scene_id, pedagogy_version, author_name, body, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.explainer_id, c.scene_id ?? null, c.pedagogy_version ?? null, c.author_name, c.body, c.created_at]
    );
  }
  console.log(`[migrate] comments: ${comments.length}`);

  const stars = rows<Record<string, unknown>>("SELECT * FROM stars");
  for (const s of stars) {
    await sql.query(
      `INSERT INTO stars (explainer_id, voter_id, created_at) VALUES ($1,$2,$3)
       ON CONFLICT (explainer_id, voter_id) DO NOTHING`,
      [s.explainer_id, s.voter_id, s.created_at]
    );
  }
  console.log(`[migrate] stars: ${stars.length}`);

  // chat_turns may not exist in very old DBs.
  let chats: Record<string, unknown>[] = [];
  try {
    chats = rows<Record<string, unknown>>("SELECT * FROM chat_turns");
  } catch {
    chats = [];
  }
  for (const t of chats) {
    await sql.query(
      `INSERT INTO chat_turns (id, explainer_id, conversation_id, role, content, selection, pedagogy_version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [t.id, t.explainer_id, t.conversation_id, t.role, t.content, t.selection ?? null, t.pedagogy_version ?? null, t.created_at]
    );
  }
  console.log(`[migrate] chat_turns: ${chats.length}`);

  lite.close();
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
