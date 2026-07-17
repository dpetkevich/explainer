/**
 * Local-only .env loader, imported for its side effect BEFORE the app module so
 * env vars are set before anything reads them. This lives OUTSIDE app.ts on
 * purpose: the Vercel serverless entry (api/index.ts) imports app.ts directly
 * and must NEVER read a bundled .env — it gets its secrets from the platform.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
