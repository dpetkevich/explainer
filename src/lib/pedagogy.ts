/**
 * The pedagogy "style" is versioned in prompts/pedagogy.json so every explainer
 * can record which set of principles produced it — the basis for comparing
 * explainers across pedagogy revisions. Bump the version + prepend a changelog
 * entry whenever the principles in prompts/storyboard.md or scene.md change.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Pedagogy {
  version: string;
  label: string;
}

export function currentPedagogy(): Pedagogy {
  const j = JSON.parse(readFileSync(join(ROOT, "prompts", "pedagogy.json"), "utf8"));
  return { version: String(j.version), label: String(j.label) };
}
