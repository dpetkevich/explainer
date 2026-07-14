/**
 * Cheap in-memory guardrails for a public, anonymous, self-serve endpoint:
 * per-IP sliding-window rate limits and a global daily cap on generations
 * (each generation spends real model tokens). State is per-process; good
 * enough for a single always-on service.
 */
const UPLOAD_MAX = Number(process.env.UPLOAD_RATE_MAX ?? "5");
const UPLOAD_WINDOW_MS = Number(process.env.UPLOAD_RATE_WINDOW_MS ?? String(10 * 60_000));
const COMMENT_MAX = Number(process.env.COMMENT_RATE_MAX ?? "10");
const COMMENT_WINDOW_MS = Number(process.env.COMMENT_RATE_WINDOW_MS ?? String(5 * 60_000));
const DAILY_GENERATION_CAP = Number(process.env.DAILY_GENERATION_CAP ?? "50");

const hits = new Map<string, number[]>();

function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

export function allowUpload(ip: string): boolean {
  return allow(`u:${ip}`, UPLOAD_MAX, UPLOAD_WINDOW_MS);
}

export function allowComment(ip: string): boolean {
  return allow(`c:${ip}`, COMMENT_MAX, COMMENT_WINDOW_MS);
}

// Stars are a raw click counter, so allow frequent increments; the cap only
// stops a runaway script.
export function allowStar(ip: string): boolean {
  return allow(`s:${ip}`, 120, 60_000);
}

let dayKey = "";
let dayCount = 0;

/** Global daily generation budget across all users, reset at UTC midnight. */
export function allowGeneration(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  if (dayCount >= DAILY_GENERATION_CAP) return false;
  dayCount += 1;
  return true;
}
