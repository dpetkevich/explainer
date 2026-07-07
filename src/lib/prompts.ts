import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function promptPath(name: string): string {
  return join(ROOT, "prompts", `${name}.md`);
}

export function templatePath(name: string): string {
  return join(ROOT, "templates", name);
}

export function loadPrompt(name: string, vars: Record<string, string>): string {
  const raw = readFileSync(promptPath(name), "utf8");
  const out = raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`prompts/${name}.md: no value for {{${key}}}`);
    return vars[key]!;
  });
  const leftover = out.match(/\{\{\w+\}\}/);
  if (leftover) throw new Error(`prompts/${name}.md: unfilled placeholder ${leftover[0]}`);
  return out;
}

export function loadPromptRaw(name: string): string {
  return readFileSync(promptPath(name), "utf8");
}
