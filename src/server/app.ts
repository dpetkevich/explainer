/**
 * The web app: a Fastify instance that serves the frontend and a read-only
 * gallery of pre-computed explainers (browse, filter, star, comment, chat).
 * Generation happens offline (scripts/regen-*.ts); this app never runs the
 * pipeline or a browser, so it deploys as a single serverless function.
 *
 * This module builds and EXPORTS the app (no listen). src/server/index.ts is the
 * local bootstrap; api/index.ts wraps it as a Vercel function.
 */
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { paths, type Ctx } from "../lib/context.js";
import {
  getExplainer,
  listExplainers,
  addComment,
  listComments,
  countComments,
  toggleStar,
  countStars,
  hasStarred,
  addChatTurn,
  listChatTurns,
  type ExplainerRow,
} from "./db.js";
import { allowComment, allowStar, allowChat } from "./limits.js";
import { chat, type ChatMessage } from "./chat.js";

// Minimal .env loader so ANTHROPIC_API_KEY / POSTGRES_URL can live in the project
// locally (mirrors cli.ts). On Vercel there is no .env file and env comes from the
// platform, so this is a no-op there.
(() => {
  const envFile = resolve(".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");

const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/" });

const clientIp = (req: { ip: string; headers: Record<string, unknown> }): string =>
  (typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0]!.trim() : "") ||
  req.ip;

// Give every browser an anonymous visitor id in an httpOnly cookie, so a star
// can be one-per-visitor without any login (best-effort: clearable, per-browser).
app.addHook("onRequest", async (req, reply) => {
  const m = (req.headers.cookie ?? "").match(/(?:^|;\s*)voter=([^;]+)/);
  let voter = m?.[1];
  if (!voter) {
    voter = randomUUID();
    reply.header("Set-Cookie", `voter=${voter}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  }
  (req as unknown as { voterId: string }).voterId = voter;
});
const voterOf = (req: unknown): string => (req as { voterId: string }).voterId;

async function toFeedItem(r: ExplainerRow, voterId: string) {
  const [stars, starredByYou, commentCount] = await Promise.all([
    countStars(r.id),
    hasStarred(r.id, voterId),
    countComments(r.id),
  ]);
  return {
    id: r.id,
    title: r.title ?? r.source_label,
    claim: r.one_sentence_claim,
    hook: r.hook,
    source: r.source_kind === "pdf" ? r.source_label : r.source_ref,
    sourceKind: r.source_kind,
    status: r.status,
    stage: r.stage,
    scenesTotal: r.scenes_total,
    scenesPassed: r.scenes_passed,
    error: r.error,
    stars,
    starredByYou,
    category: r.category ?? "Computing",
    pedagogyVersion: r.pedagogy_version,
    createdAt: r.created_at,
    commentCount,
  };
}

// ---- Feed ----
app.get("/api/explainers", async (req) => {
  const rows = await listExplainers();
  return Promise.all(rows.map((r) => toFeedItem(r, voterOf(req))));
});

app.get("/api/explainers/:id", async (req, reply) => {
  const row = await getExplainer((req.params as { id: string }).id);
  if (!row) return reply.code(404).send({ error: "Not found." });
  return toFeedItem(row, voterOf(req));
});

// ---- Serve the finished, self-contained explainer.html ----
app.get("/api/explainers/:id/html", async (req, reply) => {
  const row = await getExplainer((req.params as { id: string }).id);
  if (!row) return reply.code(404).send({ error: "Not found." });
  const file = paths.explainer({ outDir: row.out_dir } as Ctx);
  if (row.status !== "done" || !existsSync(file)) {
    return reply.code(409).send({ error: "Explainer is not ready yet." });
  }
  return reply.type("text/html").send(readFileSync(file, "utf8"));
});

// ---- Chat with this paper (multi-turn, grounded in the explainer; fable-5) ----
app.post("/api/explainers/:id/chat", async (req, reply) => {
  // Chat calls the Anthropic API server-side; without a key it is disabled so a
  // public deployment can't spend the owner's tokens.
  if (!process.env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: "Chat is unavailable on this deployment." });
  const row = await getExplainer((req.params as { id: string }).id);
  if (!row) return reply.code(404).send({ error: "Not found." });
  if (!allowChat(clientIp(req))) return reply.code(429).send({ error: "Too many messages — give it a moment." });
  const body = (req.body ?? {}) as { messages?: ChatMessage[]; selection?: string; conversationId?: string };
  const messages = Array.isArray(body.messages)
    ? body.messages.filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    : [];
  if (!messages.some((m) => m.role === "user" && m.content.trim())) {
    return reply.code(400).send({ error: "Ask a question first." });
  }
  const selection = typeof body.selection === "string" ? body.selection : undefined;
  const replyText = await chat(row.out_dir, messages.slice(-20), selection);
  // Record this turn (the latest user message + the reply) so we can mine what
  // readers ask. Anonymous — text only, grouped by a client conversation id.
  const conversationId = typeof body.conversationId === "string" && body.conversationId ? body.conversationId : randomUUID();
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) await addChatTurn(row.id, conversationId, "user", lastUser.content, selection ?? null, row.pedagogy_version);
  await addChatTurn(row.id, conversationId, "assistant", replyText, selection ?? null, row.pedagogy_version);
  return { reply: replyText };
});

app.get("/api/explainers/:id/chats", async (req, reply) => {
  const row = await getExplainer((req.params as { id: string }).id);
  if (!row) return reply.code(404).send({ error: "Not found." });
  const byConvo = new Map<string, { conversationId: string; selection: string | null; pedagogyVersion: string | null; turns: { role: string; content: string; createdAt: number }[] }>();
  for (const t of await listChatTurns(row.id)) {
    let c = byConvo.get(t.conversation_id);
    if (!c) { c = { conversationId: t.conversation_id, selection: t.selection, pedagogyVersion: t.pedagogy_version, turns: [] }; byConvo.set(t.conversation_id, c); }
    c.turns.push({ role: t.role, content: t.content, createdAt: t.created_at });
  }
  return [...byConvo.values()].sort((a, b) => (b.turns[0]?.createdAt ?? 0) - (a.turns[0]?.createdAt ?? 0));
});

// ---- Stars (a raw click counter; anonymous, no accounts) ----
app.post("/api/explainers/:id/star", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!(await getExplainer(id))) return reply.code(404).send({ error: "Not found." });
  if (!allowStar(clientIp(req))) return reply.code(429).send({ error: "Too many stars — slow down a moment." });
  return toggleStar(id, voterOf(req));
});

// ---- Comments ----
app.get("/api/explainers/:id/comments", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!(await getExplainer(id))) return reply.code(404).send({ error: "Not found." });
  return (await listComments(id)).map((c) => ({
    id: c.id,
    sceneId: c.scene_id,
    pedagogyVersion: c.pedagogy_version,
    authorName: c.author_name,
    body: c.body,
    createdAt: c.created_at,
  }));
});

app.post("/api/explainers/:id/comments", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const row = await getExplainer(id);
  if (!row) return reply.code(404).send({ error: "Not found." });
  if (!allowComment(clientIp(req))) return reply.code(429).send({ error: "Too many comments — slow down a moment." });
  const body = (req.body ?? {}) as { authorName?: string; body?: string; sceneId?: string };
  const text = (body.body ?? "").trim();
  if (!text) return reply.code(400).send({ error: "Comment cannot be empty." });
  if (text.length > 5000) return reply.code(400).send({ error: "Comment is too long (5000 chars max)." });
  const author = (body.authorName ?? "").trim().slice(0, 60) || "Anonymous";
  const sceneId = typeof body.sceneId === "string" && body.sceneId.trim() ? body.sceneId.trim() : null;
  const c = await addComment(id, author, text, sceneId, row.pedagogy_version);
  return reply.code(201).send({ id: c.id, sceneId: c.scene_id, pedagogyVersion: c.pedagogy_version, authorName: c.author_name, body: c.body, createdAt: c.created_at });
});

// ---- Viewer page (frontend handles fetching by id) ----
app.get("/explainer/:id", async (_req, reply) => reply.sendFile("explainer.html"));

app.get("/health", async () => ({ ok: true }));

export default app;
