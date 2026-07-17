/**
 * Local bootstrap: ensure the schema exists, then start the Fastify app on a
 * port. On Vercel the app is served by api/index.ts instead (no listen), so this
 * file is only used for `npm run serve` in development.
 */
import app from "./app.js";
import { initDb } from "./db.js";

const PORT = Number(process.env.PORT ?? "3000");

await initDb();
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`[server] listening on http://localhost:${PORT}`);
