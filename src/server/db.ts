/**
 * Postgres datastore for the web app (Vercel Postgres / Neon via @vercel/postgres).
 * Holds every explainer record (generation status + metadata), reader comments,
 * stars, and "chat with this paper" turns. The generated artifacts (explainer.html
 * and pipeline work dirs) live on disk under explainers/<id>/ — the DB only tracks
 * them. Connection comes from POSTGRES_URL (injected by Vercel Postgres in prod;
 * set to a Neon branch locally). All functions are async.
 */
import { sql } from "@vercel/postgres";
import { randomUUID } from "node:crypto";

export type ExplainerStatus = "queued" | "running" | "done" | "failed";
export type SourceKind = "pdf" | "url" | "text" | "arxiv";

export interface ExplainerRow {
  id: string;
  source_kind: SourceKind;
  /** URL/arXiv id/text, or the stored upload path for PDFs. */
  source_ref: string;
  /** Human-facing label of the source (filename or URL) shown before a title exists. */
  source_label: string;
  title: string | null;
  one_sentence_claim: string | null;
  /** The explainer's opening hook / abstract paragraph. */
  hook: string | null;
  status: ExplainerStatus;
  stage: string | null;
  scenes_total: number | null;
  scenes_passed: number | null;
  out_dir: string;
  error: string | null;
  stars: number;
  category: string | null;
  pedagogy_version: string | null;
  created_at: number;
  updated_at: number;
}

export interface CommentRow {
  id: string;
  explainer_id: string;
  /** Scene/section this comment is on; null = an overall comment on the whole explainer. */
  scene_id: string | null;
  /** Pedagogy version the explainer was on when this comment was left (snapshot). */
  pedagogy_version: string | null;
  author_name: string;
  body: string;
  created_at: number;
}

export interface ChatTurnRow {
  id: string;
  explainer_id: string;
  conversation_id: string;
  role: string;
  content: string;
  selection: string | null;
  pedagogy_version: string | null;
  created_at: number;
}

// Postgres returns BIGINT as a string; coerce the epoch-ms columns back to number.
function toExplainer(r: Record<string, unknown>): ExplainerRow {
  return {
    ...(r as unknown as ExplainerRow),
    scenes_total: r.scenes_total === null ? null : Number(r.scenes_total),
    scenes_passed: r.scenes_passed === null ? null : Number(r.scenes_passed),
    stars: Number(r.stars ?? 0),
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
}
function toComment(r: Record<string, unknown>): CommentRow {
  return { ...(r as unknown as CommentRow), created_at: Number(r.created_at) };
}
function toChatTurn(r: Record<string, unknown>): ChatTurnRow {
  return { ...(r as unknown as ChatTurnRow), created_at: Number(r.created_at) };
}

/** Create the schema if missing. Idempotent — safe to call at boot or from the migration script. */
export async function initDb(): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS explainers (
      id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      source_label TEXT NOT NULL,
      title TEXT,
      one_sentence_claim TEXT,
      hook TEXT,
      status TEXT NOT NULL,
      stage TEXT,
      scenes_total INTEGER,
      scenes_passed INTEGER,
      out_dir TEXT NOT NULL,
      error TEXT,
      stars INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      pedagogy_version TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      explainer_id TEXT NOT NULL,
      scene_id TEXT,
      pedagogy_version TEXT,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_comments_explainer ON comments(explainer_id, created_at);`);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS stars (
      explainer_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (explainer_id, voter_id)
    );
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS chat_turns (
      id TEXT PRIMARY KEY,
      explainer_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      selection TEXT,
      pedagogy_version TEXT,
      created_at BIGINT NOT NULL
    );
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_chat_explainer ON chat_turns(explainer_id, conversation_id, created_at);`);
  // A run cannot resume mid-flight in a fresh process, so mark anything left
  // "running" (from a crashed local generation) as failed.
  await sql.query(`UPDATE explainers SET status='failed', error='interrupted by a restart', updated_at=$1 WHERE status='running'`, [
    Date.now(),
  ]);
}

export async function createExplainer(input: {
  id?: string;
  sourceKind: SourceKind;
  sourceRef: string;
  sourceLabel: string;
  outDir: string;
}): Promise<ExplainerRow> {
  const id = input.id ?? randomUUID().slice(0, 8);
  const now = Date.now();
  await sql.query(
    `INSERT INTO explainers (id, source_kind, source_ref, source_label, status, out_dir, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7)`,
    [id, input.sourceKind, input.sourceRef, input.sourceLabel, input.outDir, now, now]
  );
  return (await getExplainer(id))!;
}

export async function deleteExplainer(id: string): Promise<void> {
  await sql.query(`DELETE FROM explainers WHERE id = $1`, [id]);
}

export async function getExplainer(id: string): Promise<ExplainerRow | undefined> {
  const { rows } = await sql.query(`SELECT * FROM explainers WHERE id = $1`, [id]);
  return rows[0] ? toExplainer(rows[0]) : undefined;
}

export async function listExplainers(): Promise<ExplainerRow[]> {
  const { rows } = await sql.query(`SELECT * FROM explainers ORDER BY created_at DESC`);
  return rows.map(toExplainer);
}

export async function listQueued(): Promise<ExplainerRow[]> {
  const { rows } = await sql.query(`SELECT * FROM explainers WHERE status='queued' ORDER BY created_at ASC`);
  return rows.map(toExplainer);
}

type ExplainerPatch = Partial<
  Pick<
    ExplainerRow,
    | "title"
    | "one_sentence_claim"
    | "hook"
    | "status"
    | "stage"
    | "scenes_total"
    | "scenes_passed"
    | "error"
    | "category"
    | "pedagogy_version"
  >
>;

export async function updateExplainer(id: string, patch: ExplainerPatch): Promise<void> {
  const keys = Object.keys(patch) as (keyof ExplainerPatch)[];
  if (keys.length === 0) return;
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  values.push(Date.now(), id);
  await sql.query(
    `UPDATE explainers SET ${set}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`,
    values
  );
}

/** Toggle one anonymous visitor's star for an explainer; returns the new total + their state. */
export async function toggleStar(explainerId: string, voterId: string): Promise<{ stars: number; starred: boolean }> {
  const { rows } = await sql.query(`SELECT 1 FROM stars WHERE explainer_id = $1 AND voter_id = $2`, [explainerId, voterId]);
  const existing = rows.length > 0;
  if (existing) {
    await sql.query(`DELETE FROM stars WHERE explainer_id = $1 AND voter_id = $2`, [explainerId, voterId]);
  } else {
    await sql.query(
      `INSERT INTO stars (explainer_id, voter_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (explainer_id, voter_id) DO NOTHING`,
      [explainerId, voterId, Date.now()]
    );
  }
  return { stars: await countStars(explainerId), starred: !existing };
}

export async function countStars(explainerId: string): Promise<number> {
  const { rows } = await sql.query(`SELECT COUNT(*)::int AS n FROM stars WHERE explainer_id = $1`, [explainerId]);
  return Number(rows[0]?.n ?? 0);
}

export async function hasStarred(explainerId: string, voterId: string): Promise<boolean> {
  const { rows } = await sql.query(`SELECT 1 FROM stars WHERE explainer_id = $1 AND voter_id = $2`, [explainerId, voterId]);
  return rows.length > 0;
}

export async function addComment(
  explainerId: string,
  authorName: string,
  body: string,
  sceneId: string | null = null,
  pedagogyVersion: string | null = null
): Promise<CommentRow> {
  const id = randomUUID();
  const now = Date.now();
  await sql.query(
    `INSERT INTO comments (id, explainer_id, scene_id, pedagogy_version, author_name, body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, explainerId, sceneId, pedagogyVersion, authorName, body, now]
  );
  return { id, explainer_id: explainerId, scene_id: sceneId, pedagogy_version: pedagogyVersion, author_name: authorName, body, created_at: now };
}

export async function listComments(explainerId: string): Promise<CommentRow[]> {
  const { rows } = await sql.query(`SELECT * FROM comments WHERE explainer_id = $1 ORDER BY created_at ASC`, [explainerId]);
  return rows.map(toComment);
}

export async function countComments(explainerId: string): Promise<number> {
  const { rows } = await sql.query(`SELECT COUNT(*)::int AS n FROM comments WHERE explainer_id = $1`, [explainerId]);
  return Number(rows[0]?.n ?? 0);
}

/** Record one turn of a "chat with this paper" conversation (anonymous — text only). */
export async function addChatTurn(
  explainerId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  selection: string | null = null,
  pedagogyVersion: string | null = null
): Promise<void> {
  await sql.query(
    `INSERT INTO chat_turns (id, explainer_id, conversation_id, role, content, selection, pedagogy_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), explainerId, conversationId, role, content, selection, pedagogyVersion, Date.now()]
  );
}

/** All recorded chat turns for an explainer, oldest first within each conversation. */
export async function listChatTurns(explainerId: string): Promise<ChatTurnRow[]> {
  const { rows } = await sql.query(
    `SELECT * FROM chat_turns WHERE explainer_id = $1 ORDER BY conversation_id, created_at`,
    [explainerId]
  );
  return rows.map(toChatTurn);
}
