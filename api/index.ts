/**
 * Vercel serverless entry: wraps the Fastify app as a single Node function.
 * All routes (API + page routes + static assets) flow through here via the
 * catch-all rewrite in vercel.json. The schema is provisioned out-of-band by
 * scripts/migrate-to-postgres.ts, so we don't run DDL per cold start.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../src/server/app.js";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await app.ready();
  app.server.emit("request", req, res);
}
