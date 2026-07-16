/**
 * Prose review of the freshly generated script — the abstract (the listing
 * gist), the hook, and every caption. A model reads the text and flags slop,
 * contrived metaphors, undefined terms, and unclear / run-on sentences; a
 * deterministic check independently flags any over-long sentence (the model is
 * unreliable at catching its own run-ons). Failures are auto-revised and
 * re-reviewed. Runs before any graphics; edits only prose (abstract lives in the
 * concept map; hook + captions are outside the scene contract), so it never
 * triggers scene regeneration.
 */
import { writeFileSync } from "node:fs";
import { callModel, MODELS, stripJsonFences } from "../lib/anthropic.js";
import { loadPrompt } from "../lib/prompts.js";
import { ScriptReviewSchema, StoryboardSchema, type ScriptReview, type ConceptMap, type Storyboard } from "../lib/schemas.js";
import { info, warn } from "../lib/log.js";
import { paths, type Ctx } from "../lib/context.js";

const MAX_REVISIONS = 2;
const LONG_SENTENCE_WORDS = 30;

type Issue = { where: string; kind: string; detail: string };

function scriptText(abstract: string, board: Storyboard): string {
  const lines = [`TITLE: ${board.title}`, "", `ABSTRACT: ${abstract}`, "", `HOOK: ${board.hook}`, ""];
  // Walk the arc part by part so the reviewer can see the throughline: each
  // part's lede, then its scenes in order with what each one teaches and builds on.
  const sceneLine = (s: Storyboard["scenes"][number]) => {
    const req = s.requires.length ? ` (builds on: ${s.requires.join(", ")})` : "";
    return [`  [${s.id}] ${s.title}${req}`, `    TEACHES: ${s.teaches}`, `    CAPTION: ${s.caption}`];
  };
  const parts = board.parts ?? [];
  if (parts.length === 0) {
    for (const s of board.scenes) lines.push(...sceneLine(s));
  } else {
    for (const part of parts) {
      lines.push(`PART — ${part.title}`, `  LEDE: ${part.lede}`);
      for (const s of board.scenes.filter((sc) => sc.part === part.title)) lines.push(...sceneLine(s));
    }
  }
  return lines.join("\n");
}

/** Split into sentences and count words, ignoring inline \( … \) math. */
function longSentences(text: string): string[] {
  const plain = text.replace(/\\\([^)]*\\\)/g, "X");
  return plain
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length > LONG_SENTENCE_WORDS);
}

/** Deterministic run-on backstop over abstract + hook + captions. */
function longSentenceIssues(abstract: string, board: Storyboard): Issue[] {
  const issues: Issue[] = [];
  const add = (where: string, text: string) => {
    for (const s of longSentences(text)) {
      issues.push({ where, kind: "too-wordy", detail: `Sentence runs long (>${LONG_SENTENCE_WORDS} words) — split into shorter one-idea sentences: "${s.slice(0, 80)}…"` });
    }
  };
  add("abstract", abstract);
  add("hook", board.hook);
  for (const s of board.scenes) add(s.id, s.caption);
  // The list abstract must stay short: cap at 3 sentences.
  const abstractSentences = abstract.replace(/\\\([^)]*\\\)/g, "X").split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;
  if (abstractSentences > 3) {
    issues.push({ where: "abstract", kind: "too-wordy", detail: `The abstract has ${abstractSentences} sentences — trim it to 2–3 short sentences (what, why, and the one headline number).` });
  }
  return issues;
}

async function reviewScript(ctx: Ctx, abstract: string, board: Storyboard): Promise<ScriptReview> {
  try {
    const prompt = loadPrompt("script-review", { audience: ctx.audienceRaw, script: scriptText(abstract, board) });
    // fable-5 is a thinking model and the coherence pass reasons over the whole
    // arc, so budget generously — 8000 truncated the JSON and silently skipped the pass.
    const raw = await callModel({ model: MODELS.prose, messages: [{ role: "user", content: prompt }], maxTokens: 32000 });
    const parsed = ScriptReviewSchema.safeParse(JSON.parse(stripJsonFences(raw)));
    if (parsed.success) return parsed.data;
  } catch (err) {
    warn("script-review", `prose review unavailable (${err instanceof Error ? err.message : String(err)}) — skipping model pass`);
  }
  return { pass: true, issues: [] };
}

async function reviseScript(
  ctx: Ctx,
  abstract: string,
  board: Storyboard,
  issues: Issue[]
): Promise<{ abstract: string; board: Storyboard }> {
  const prompt = loadPrompt("script-revise", {
    audience: ctx.audienceRaw,
    issues: issues.map((i) => `- [${i.where} / ${i.kind}] ${i.detail}`).join("\n"),
    script: scriptText(abstract, board),
  });
  let data: { abstract?: unknown; hook?: unknown; captions?: Record<string, unknown> };
  try {
    const raw = await callModel({ model: MODELS.planning, messages: [{ role: "user", content: prompt }], maxTokens: 32000 });
    data = JSON.parse(stripJsonFences(raw));
  } catch {
    return { abstract, board };
  }
  const nextAbstract = typeof data.abstract === "string" && data.abstract.trim() ? data.abstract.trim() : abstract;
  const next: Storyboard = { ...board, scenes: board.scenes.map((s) => ({ ...s })) };
  if (typeof data.hook === "string" && data.hook.trim()) next.hook = data.hook.trim();
  const caps = data.captions ?? {};
  for (const s of next.scenes) {
    const c = caps[s.id];
    if (typeof c === "string" && c.trim()) s.caption = c.trim();
  }
  const v = StoryboardSchema.safeParse(next);
  return { abstract: nextAbstract, board: v.success ? v.data : board };
}

/**
 * Review the script's prose (abstract + hook + captions) and auto-revise until
 * it passes (bounded). Mutates conceptMap.paper.oneSentenceClaim (and rewrites
 * concept-map.json) if the abstract was improved; returns the improved board.
 */
export async function reviewAndReviseScript(ctx: Ctx, board: Storyboard, conceptMap: ConceptMap): Promise<Storyboard> {
  let abstract = conceptMap.paper.oneSentenceClaim;
  for (let attempt = 0; ; attempt++) {
    const modelReport = await reviewScript(ctx, abstract, board);
    const issues: Issue[] = [...modelReport.issues, ...longSentenceIssues(abstract, board)];
    if (issues.length === 0) {
      if (attempt > 0) info("script-review", "prose passed after revision");
      break;
    }
    info("script-review", `prose issues (${issues.length}): ${issues.map((i) => `${i.where}/${i.kind}`).join(", ")}`);
    if (attempt >= MAX_REVISIONS) {
      warn("script-review", `still ${issues.length} prose issue(s) after ${MAX_REVISIONS} revisions — proceeding`);
      break;
    }
    info("script-review", `revising prose (${attempt + 1}/${MAX_REVISIONS})`);
    const revised = await reviseScript(ctx, abstract, board, issues);
    abstract = revised.abstract;
    board = revised.board;
  }
  if (abstract !== conceptMap.paper.oneSentenceClaim) {
    conceptMap.paper.oneSentenceClaim = abstract;
    writeFileSync(paths.conceptMap(ctx), JSON.stringify(conceptMap, null, 2));
  }
  return board;
}
