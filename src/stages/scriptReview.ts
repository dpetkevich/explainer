/**
 * Prose review of the freshly generated script: a model reads the hook + every
 * caption (text only, no screenshots) and flags slop, contrived non-idiomatic
 * metaphors, undefined terms, and over-long prose. Failures are auto-revised by
 * the planning model and re-reviewed. This runs before any graphics are made,
 * and only edits prose fields (hook, captions) — which are outside the scene
 * contract, so it never triggers scene regeneration.
 */
import { callModel, MODELS, stripJsonFences } from "../lib/anthropic.js";
import { loadPrompt } from "../lib/prompts.js";
import { ScriptReviewSchema, StoryboardSchema, type ScriptReview, type Storyboard } from "../lib/schemas.js";
import { info, warn } from "../lib/log.js";
import type { Ctx } from "../lib/context.js";

const MAX_REVISIONS = 2;

function scriptText(board: Storyboard): string {
  const lines = [`HOOK: ${board.hook}`, ""];
  for (const s of board.scenes) lines.push(`[${s.id}] ${s.title}\n  CAPTION: ${s.caption}`);
  return lines.join("\n");
}

async function reviewScript(ctx: Ctx, board: Storyboard): Promise<ScriptReview> {
  // Best-effort quality enhancer, never a hard gate: a malformed review, a
  // model error, or a refusal (fable-5 may decline some content) all degrade to
  // a pass rather than failing the generation.
  try {
    const prompt = loadPrompt("script-review", { audience: ctx.audienceRaw, script: scriptText(board) });
    const raw = await callModel({ model: MODELS.prose, messages: [{ role: "user", content: prompt }], maxTokens: 8000 });
    const parsed = ScriptReviewSchema.safeParse(JSON.parse(stripJsonFences(raw)));
    if (parsed.success) return parsed.data;
  } catch (err) {
    warn("script-review", `prose review unavailable (${err instanceof Error ? err.message : String(err)}) — skipping`);
  }
  return { pass: true, issues: [] };
}

async function reviseScript(ctx: Ctx, board: Storyboard, issues: { where: string; kind: string; detail: string }[]): Promise<Storyboard> {
  const prompt = loadPrompt("script-revise", {
    audience: ctx.audienceRaw,
    issues: issues.map((i) => `- [${i.where} / ${i.kind}] ${i.detail}`).join("\n"),
    script: scriptText(board),
  });
  const raw = await callModel({ model: MODELS.planning, messages: [{ role: "user", content: prompt }], maxTokens: 16000 });
  let data: { hook?: unknown; captions?: Record<string, unknown> };
  try {
    data = JSON.parse(stripJsonFences(raw));
  } catch {
    return board;
  }
  const next: Storyboard = { ...board, scenes: board.scenes.map((s) => ({ ...s })) };
  if (typeof data.hook === "string" && data.hook.trim()) next.hook = data.hook.trim();
  const caps = data.captions ?? {};
  for (const s of next.scenes) {
    const c = caps[s.id];
    if (typeof c === "string" && c.trim()) s.caption = c.trim();
  }
  // Re-validate; if the rewrite broke the schema, keep the original.
  const v = StoryboardSchema.safeParse(next);
  return v.success ? v.data : board;
}

/** Review the script's prose and auto-revise until it passes (bounded). Returns the improved board. */
export async function reviewAndReviseScript(ctx: Ctx, board: Storyboard): Promise<Storyboard> {
  for (let attempt = 0; ; attempt++) {
    const report = await reviewScript(ctx, board);
    if (report.pass || report.issues.length === 0) {
      if (attempt > 0) info("script-review", "prose passed after revision");
      return board;
    }
    info("script-review", `prose issues (${report.issues.length}): ${report.issues.map((i) => `${i.where}/${i.kind}`).join(", ")}`);
    if (attempt >= MAX_REVISIONS) {
      warn("script-review", `still ${report.issues.length} prose issue(s) after ${MAX_REVISIONS} revisions — proceeding`);
      return board;
    }
    info("script-review", `revising prose (${attempt + 1}/${MAX_REVISIONS})`);
    board = await reviseScript(ctx, board, report.issues);
  }
}
