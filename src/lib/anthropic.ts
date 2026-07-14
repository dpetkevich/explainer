import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    client = new Anthropic();
  }
  return client;
}

export const MODELS = {
  planning: process.env.PLANNING_MODEL ?? "claude-fable-5",
  codegen: process.env.CODEGEN_MODEL ?? "claude-sonnet-5",
  review: process.env.REVIEW_MODEL ?? "claude-sonnet-5",
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);
const MAX_ATTEMPTS = 3;

/** Thrown when the model declines to answer (stop_reason "refusal") — e.g. some dual-use content. */
export class RefusalError extends Error {
  constructor(public model: string) {
    super("the model declined to generate a response for this content");
    this.name = "RefusalError";
  }
}

export interface CallOptions {
  model: string;
  system?: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}

/** One model call, retried with exponential backoff on rate limits / overload. */
export async function callModel(opts: CallOptions): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Stream and accumulate: the SDK rejects non-streaming requests with
      // large max_tokens because they can exceed its 10-minute ceiling.
      const res = await getClient()
        .messages.stream({
          model: opts.model,
          max_tokens: opts.maxTokens ?? 16000,
          system: opts.system,
          messages: opts.messages,
        })
        .finalMessage();
      // "refusal" isn't in every SDK version's stop_reason union; compare as a string.
      if ((res.stop_reason as string | null) === "refusal") {
        // A refusal will not improve on retry; surface it as a typed error so
        // callers can report "content declined" instead of a downstream parse failure.
        throw new RefusalError(opts.model);
      }
      if (res.stop_reason === "max_tokens") {
        console.warn(`⚠ model response truncated at max_tokens=${opts.maxTokens ?? 16000} (${opts.model})`);
      } else if (res.stop_reason !== "end_turn") {
        console.warn(`⚠ model stopped with stop_reason=${res.stop_reason} (${opts.model})`);
      }
      return res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    } catch (err) {
      lastErr = err;
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      const retryable =
        (status !== undefined && RETRYABLE_STATUS.has(status)) ||
        err instanceof Anthropic.APIConnectionError;
      if (!retryable || attempt === MAX_ATTEMPTS) throw err;
      const delay = 2000 * 2 ** (attempt - 1) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Strip markdown fences and any prose surrounding the outermost JSON object,
 * then return the JSON string ready for JSON.parse.
 */
export function stripJsonFences(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

/** Extract a complete HTML document from a model response that may wrap it in fences or prose. */
export function extractHtml(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fence?.[1] && /<!doctype html>/i.test(fence[1])) t = fence[1].trim();
  const start = t.search(/<!doctype html>/i);
  if (start > 0) t = t.slice(start);
  const end = t.lastIndexOf("</html>");
  if (end >= 0) t = t.slice(0, end + "</html>".length);
  return t;
}
