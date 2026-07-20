import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface TimingSpan {
  /** e.g. "stage:ingest", "scene:kv-cache:generate", "qa:kv-cache:render+review#2", "qa:kv-cache:repair#1" */
  name: string;
  startedAt: string;
  ms: number;
}

let timingsFile: string | null = null;

/** Point the collector at <workDir>/timings.json. Each run appends; the file survives across runs. */
export function initTimings(workDir: string): void {
  timingsFile = join(workDir, "timings.json");
}

export function recordSpan(name: string, startMs: number): void {
  if (!timingsFile) return;
  const span: TimingSpan = {
    name,
    startedAt: new Date(startMs).toISOString(),
    ms: Date.now() - startMs,
  };
  // Concurrent scene workers all append here; a read-modify-write race can at
  // worst drop a span from the report, never corrupt an artifact.
  const spans: TimingSpan[] = existsSync(timingsFile)
    ? (JSON.parse(readFileSync(timingsFile, "utf8")) as TimingSpan[])
    : [];
  spans.push(span);
  mkdirSync(dirname(timingsFile), { recursive: true });
  writeFileSync(timingsFile, JSON.stringify(spans, null, 2));
}

/** Time an async step and record it under `name`. */
export async function span<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    recordSpan(name, t0);
  }
}
