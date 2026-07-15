/**
 * "Chat with this paper": a stateless multi-turn Q&A grounded in one explainer's
 * paper + storyboard. The client sends the running message history each turn; we
 * build the paper context from the explainer's work/ artifacts and answer on
 * fable-5. Ephemeral — nothing is stored server-side.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { callModel, MODELS } from "../lib/anthropic.js";
import { loadPrompt } from "../lib/prompts.js";
import { ConceptMapSchema, StoryboardSchema, AudienceProfileSchema } from "../lib/schemas.js";
import { warn } from "../lib/log.js";

const SOURCE_CHARS = 12000; // cap the raw paper text included as grounding

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_AUDIENCE = process.env.AUDIENCE_PROFILE ?? "profiles/default.json";

/** Distill the paper + explainer into a compact text context from the explainer's work dir. */
function assembleContext(outDir: string): string {
  const work = join(outDir, "work");
  const parts: string[] = [];
  try {
    const cm = ConceptMapSchema.parse(JSON.parse(readFileSync(join(work, "concept-map.json"), "utf8")));
    parts.push(`PAPER: ${cm.paper.title}\nBY: ${cm.paper.authors.join(", ")}\nCLAIM: ${cm.paper.oneSentenceClaim}`);
    parts.push(
      "KEY CONCEPTS:\n" +
        cm.concepts.map((c) => `- ${c.name}: ${c.coreMechanism}${c.keyEquation ? ` [eq: ${c.keyEquation}]` : ""}`).join("\n")
    );
  } catch {
    /* concept map missing/invalid — skip */
  }
  try {
    const sb = StoryboardSchema.parse(JSON.parse(readFileSync(join(work, "storyboard.json"), "utf8")));
    parts.push(`EXPLAINER TITLE: ${sb.title}\nHOOK: ${sb.hook}`);
    parts.push(
      "EXPLAINER SCENES:\n" + sb.scenes.map((s) => `- ${s.title} — teaches: ${s.teaches}\n  ${s.caption}`).join("\n")
    );
  } catch {
    /* storyboard missing/invalid — skip */
  }
  const sourceFile = join(work, "source.md");
  if (existsSync(sourceFile)) {
    const src = readFileSync(sourceFile, "utf8").trim();
    parts.push(`PAPER SOURCE TEXT (excerpt):\n${src.slice(0, SOURCE_CHARS)}${src.length > SOURCE_CHARS ? "\n…(truncated)" : ""}`);
  }
  return parts.join("\n\n");
}

function audienceText(): string {
  try {
    return JSON.stringify(AudienceProfileSchema.parse(JSON.parse(readFileSync(DEFAULT_AUDIENCE, "utf8"))), null, 2);
  } catch {
    return "A curious non-expert reader.";
  }
}

/** Answer the latest turn of a chat, grounded in the explainer's paper. Returns the reply text. */
export async function chat(outDir: string, messages: ChatMessage[], selection?: string): Promise<string> {
  const system = loadPrompt("chat", {
    audience: audienceText(),
    context: assembleContext(outDir),
    selection: selection?.trim() ? selection.trim() : "(none — the reader hasn't highlighted anything)",
  });
  const convo: Anthropic.MessageParam[] = messages
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
  try {
    return await callModel({ model: MODELS.chat, system, messages: convo, maxTokens: 4000 });
  } catch (err) {
    warn("chat", `chat failed (${err instanceof Error ? err.message : String(err)})`);
    return "I can't help with that right now — please try again in a moment.";
  }
}
