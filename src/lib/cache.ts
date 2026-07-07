import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface HashInputs {
  /** Contents (not paths) of upstream artifacts feeding this stage. */
  artifacts: string[];
  /** Prompt template contents ("" for model-free stages). */
  prompt: string;
  /** Model name ("" for model-free stages). */
  model: string;
}

export function stageHash(inputs: HashInputs): string {
  const h = createHash("sha256");
  for (const a of inputs.artifacts) h.update(a).update("\0");
  h.update(inputs.prompt).update("\0").update(inputs.model);
  return h.digest("hex");
}

/**
 * A stage (or scene) is fresh when its recorded input hash matches and every
 * output it claims to have produced still exists on disk.
 */
export function isFresh(hashFile: string, hash: string, outputs: string[]): boolean {
  if (!existsSync(hashFile)) return false;
  if (readFileSync(hashFile, "utf8").trim() !== hash) return false;
  return outputs.every((o) => existsSync(o));
}

export function recordHash(hashFile: string, hash: string): void {
  mkdirSync(dirname(hashFile), { recursive: true });
  writeFileSync(hashFile, hash);
}
