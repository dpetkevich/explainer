/**
 * SQLite datastore for the self-serve web app. A single file under data/
 * holds every explainer record (generation status + metadata) and every
 * comment. Artifacts (the generated explainer.html and pipeline work dirs)
 * stay on disk under explainers/<id>/ — the DB only tracks them.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const DATA_DIR = process.env.DATA_DIR ?? "data";
export const UPLOADS_DIR = join(DATA_DIR, "uploads");

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
  status: ExplainerStatus;
  stage: string | null;
  scenes_total: number | null;
  scenes_passed: number | null;
  out_dir: string;
  error: string | null;
  stars: number;
  created_at: number;
  updated_at: number;
}

export interface CommentRow {
  id: string;
  explainer_id: string;
  author_name: string;
  body: string;
  created_at: number;
}

let db: Database.Database;

export function initDb(): Database.Database {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(UPLOADS_DIR, { recursive: true });
  db = new Database(join(DATA_DIR, "explainers.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS explainers (
      id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      source_label TEXT NOT NULL,
      title TEXT,
      one_sentence_claim TEXT,
      status TEXT NOT NULL,
      stage TEXT,
      scenes_total INTEGER,
      scenes_passed INTEGER,
      out_dir TEXT NOT NULL,
      error TEXT,
      stars INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      explainer_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_explainer ON comments(explainer_id, created_at);
    CREATE TABLE IF NOT EXISTS stars (
      explainer_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (explainer_id, voter_id)
    );
  `);
  // Columns added after the initial schema (SQLite has no IF NOT EXISTS for columns).
  const cols = (db.prepare("PRAGMA table_info(explainers)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("stars")) db.exec("ALTER TABLE explainers ADD COLUMN stars INTEGER NOT NULL DEFAULT 0");
  // A run cannot resume mid-flight in a fresh process, so mark anything that was
  // "running" as failed on boot. "queued" rows never started, so the queue can
  // safely pick them up again (see resumeQueued in queue.ts).
  db.prepare(
    `UPDATE explainers SET status='failed', error='interrupted by a server restart', updated_at=?
     WHERE status='running'`
  ).run(Date.now());
  return db;
}

export function createExplainer(input: {
  id?: string;
  sourceKind: SourceKind;
  sourceRef: string;
  sourceLabel: string;
  outDir: string;
}): ExplainerRow {
  const id = input.id ?? randomUUID().slice(0, 8);
  const now = Date.now();
  db.prepare(
    `INSERT INTO explainers (id, source_kind, source_ref, source_label, status, out_dir, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`
  ).run(id, input.sourceKind, input.sourceRef, input.sourceLabel, input.outDir, now, now);
  return getExplainer(id)!;
}

export function getExplainer(id: string): ExplainerRow | undefined {
  return db.prepare(`SELECT * FROM explainers WHERE id = ?`).get(id) as ExplainerRow | undefined;
}

export function listExplainers(): ExplainerRow[] {
  return db.prepare(`SELECT * FROM explainers ORDER BY created_at DESC`).all() as ExplainerRow[];
}

export function listQueued(): ExplainerRow[] {
  return db.prepare(`SELECT * FROM explainers WHERE status='queued' ORDER BY created_at ASC`).all() as ExplainerRow[];
}

type ExplainerPatch = Partial<
  Pick<
    ExplainerRow,
    "title" | "one_sentence_claim" | "status" | "stage" | "scenes_total" | "scenes_passed" | "error"
  >
>;

export function updateExplainer(id: string, patch: ExplainerPatch): void {
  const keys = Object.keys(patch) as (keyof ExplainerPatch)[];
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE explainers SET ${set}, updated_at = ? WHERE id = ?`).run(...values, Date.now(), id);
}

/** Toggle one anonymous visitor's star for an explainer; returns the new total + their state. */
export function toggleStar(explainerId: string, voterId: string): { stars: number; starred: boolean } {
  const existing = db.prepare(`SELECT 1 FROM stars WHERE explainer_id = ? AND voter_id = ?`).get(explainerId, voterId);
  if (existing) {
    db.prepare(`DELETE FROM stars WHERE explainer_id = ? AND voter_id = ?`).run(explainerId, voterId);
  } else {
    db.prepare(`INSERT INTO stars (explainer_id, voter_id, created_at) VALUES (?, ?, ?)`).run(explainerId, voterId, Date.now());
  }
  return { stars: countStars(explainerId), starred: !existing };
}

export function countStars(explainerId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM stars WHERE explainer_id = ?`).get(explainerId) as { n: number }).n;
}

export function hasStarred(explainerId: string, voterId: string): boolean {
  return !!db.prepare(`SELECT 1 FROM stars WHERE explainer_id = ? AND voter_id = ?`).get(explainerId, voterId);
}

export function addComment(explainerId: string, authorName: string, body: string): CommentRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO comments (id, explainer_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, explainerId, authorName, body, now);
  return { id, explainer_id: explainerId, author_name: authorName, body, created_at: now };
}

export function listComments(explainerId: string): CommentRow[] {
  return db
    .prepare(`SELECT * FROM comments WHERE explainer_id = ? ORDER BY created_at ASC`)
    .all(explainerId) as CommentRow[];
}

export function countComments(explainerId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM comments WHERE explainer_id = ?`).get(explainerId) as {
    n: number;
  };
  return row.n;
}
