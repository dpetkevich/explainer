/**
 * The web app: one always-on Fastify service that serves the frontend and a
 * read-only gallery of explainers (browse, filter, star, comment). Papers are
 * added out-of-band via the CLI + a DB seed, not uploaded through the web —
 * there is intentionally no upload endpoint. See src/server/{db,sse,limits}.ts.
 */
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { paths, type Ctx } from "../lib/context.js";
import {
  initDb,
  getExplainer,
  listExplainers,
  addComment,
  listComments,
  countComments,
  toggleStar,
  countStars,
  hasStarred,
  type ExplainerRow,
} from "./db.js";
import { resumeQueued, queueDepth } from "./queue.js";
import { allowComment, allowStar } from "./limits.js";
import { subscribe, type StreamMessage } from "./sse.js";

// Minimal .env loader so ANTHROPIC_API_KEY can live in the project (mirrors cli.ts).
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
const PORT = Number(process.env.PORT ?? "3000");

initDb();

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

function toFeedItem(r: ExplainerRow, voterId: string) {
  return {
    id: r.id,
    title: r.title ?? r.source_label,
    claim: r.one_sentence_claim,
    source: r.source_kind === "pdf" ? r.source_label : r.source_ref,
    sourceKind: r.source_kind,
    status: r.status,
    stage: r.stage,
    scenesTotal: r.scenes_total,
    scenesPassed: r.scenes_passed,
    error: r.error,
    stars: countStars(r.id),
    starredByYou: hasStarred(r.id, voterId),
    category: r.category ?? "Computing",
    pedagogyVersion: r.pedagogy_version,
    createdAt: r.created_at,
    commentCount: countComments(r.id),
  };
}

// ---- Feed ----
app.get("/api/explainers", async (req) => listExplainers().map((r) => toFeedItem(r, voterOf(req))));

app.get("/api/explainers/:id", async (req, reply) => {
  const row = getExplainer((req.params as { id: string }).id);
  if (!row) return reply.code(404).send({ error: "Not found." });
  return toFeedItem(row, voterOf(req));
});

// ---- Serve the finished, self-contained explainer.html ----
app.get("/api/explainers/:id/html", async (req, reply) => {
  const row = getExplainer((req.params as { id: string }).id);
  if (!row) return reply.code(404).send({ error: "Not found." });
  const file = paths.explainer({ outDir: row.out_dir } as Ctx);
  if (row.status !== "done" || !existsSync(file)) {
    return reply.code(409).send({ error: "Explainer is not ready yet." });
  }
  return reply.type("text/html").send(readFileSync(file, "utf8"));
});

// ---- Live progress (SSE) ----
app.get("/api/explainers/:id/events", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const row = getExplainer(id);
  if (!row) return reply.code(404).send({ error: "Not found." });

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (msg: StreamMessage) => reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);

  // Snapshot first so a late subscriber (or a reconnect) gets current state.
  send({ type: "snapshot", ...toFeedItem(row, voterOf(req)) } as unknown as StreamMessage);
  if (row.status === "done" || row.status === "failed") {
    send({ type: "closed", status: row.status, error: row.error ?? undefined });
    reply.raw.end();
    return reply;
  }

  const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
  const unsubscribe = subscribe(id, (msg) => {
    send(msg);
    if (msg.type === "closed") {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    }
  });
  req.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return reply;
});

// ---- Stars (a raw click counter; anonymous, no accounts) ----
app.post("/api/explainers/:id/star", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!getExplainer(id)) return reply.code(404).send({ error: "Not found." });
  if (!allowStar(clientIp(req))) return reply.code(429).send({ error: "Too many stars — slow down a moment." });
  return toggleStar(id, voterOf(req));
});

// ---- Comments ----
app.get("/api/explainers/:id/comments", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!getExplainer(id)) return reply.code(404).send({ error: "Not found." });
  return listComments(id).map((c) => ({
    id: c.id,
    sceneId: c.scene_id,
    authorName: c.author_name,
    body: c.body,
    createdAt: c.created_at,
  }));
});

app.post("/api/explainers/:id/comments", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!getExplainer(id)) return reply.code(404).send({ error: "Not found." });
  if (!allowComment(clientIp(req))) return reply.code(429).send({ error: "Too many comments — slow down a moment." });
  const body = (req.body ?? {}) as { authorName?: string; body?: string; sceneId?: string };
  const text = (body.body ?? "").trim();
  if (!text) return reply.code(400).send({ error: "Comment cannot be empty." });
  if (text.length > 5000) return reply.code(400).send({ error: "Comment is too long (5000 chars max)." });
  const author = (body.authorName ?? "").trim().slice(0, 60) || "Anonymous";
  const sceneId = typeof body.sceneId === "string" && body.sceneId.trim() ? body.sceneId.trim() : null;
  const c = addComment(id, author, text, sceneId);
  return reply.code(201).send({ id: c.id, sceneId: c.scene_id, authorName: c.author_name, body: c.body, createdAt: c.created_at });
});

// ---- Viewer page (frontend handles fetching by id) ----
app.get("/explainer/:id", async (_req, reply) => reply.sendFile("explainer.html"));

app.get("/health", async () => ({ ok: true, queue: queueDepth() }));

resumeQueued();
app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
