import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import type Anthropic from "@anthropic-ai/sdk";
import { callModel, MODELS, stripJsonFences } from "../lib/anthropic.js";
import { stageHash, isFresh, recordHash } from "../lib/cache.js";
import { loadPrompt, loadPromptRaw } from "../lib/prompts.js";
import { ConceptMapSchema, type ConceptMap } from "../lib/schemas.js";
import { info, warn, StageError } from "../lib/log.js";
import { emit } from "../lib/progress.js";
import { paths, arxivId, type Ctx } from "../lib/context.js";

async function fetchArticleText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (explain-it CLI; article extraction)" },
  });
  if (!res.ok) {
    throw new StageError("ingest", `fetch failed for ${url}: HTTP ${res.status}`);
  }
  const html = await res.text();
  // Readability chokes loudly on modern CSS; silence jsdom's parse noise.
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { url, virtualConsole: vc });
  const article = new Readability(dom.window.document).parse();
  if (!article?.textContent?.trim()) {
    throw new StageError("ingest", `Readability could not extract an article body from ${url}`);
  }
  const title = article.title ? `# ${article.title}\n\n` : "";
  const byline = article.byline ? `_${article.byline}_\n\n` : "";
  return title + byline + article.textContent.trim() + "\n";
}

/** Download an arXiv paper's PDF and cache the bytes under work/. */
async function fetchArxivPdf(ctx: Ctx): Promise<Buffer> {
  const cached = paths.sourcePdf(ctx);
  if (existsSync(cached) && !ctx.force) {
    info("ingest", `using cached PDF ${cached}`);
    return readFileSync(cached);
  }
  const url = `https://arxiv.org/pdf/${arxivId(ctx.input)}`;
  info("ingest", `downloading ${url}`);
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (explain-it CLI; paper extraction)" },
  });
  if (!res.ok) {
    throw new StageError("ingest", `arXiv PDF fetch failed for ${url}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.subarray(0, 5).toString("latin1").startsWith("%PDF")) {
    throw new StageError("ingest", `arXiv response for ${url} is not a PDF (got ${buf.length} bytes starting "${buf.subarray(0, 12).toString("latin1")}")`);
  }
  mkdirSync(ctx.workDir, { recursive: true });
  writeFileSync(cached, buf);
  info("ingest", `cached PDF to ${cached} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  return buf;
}

/** Resolve the source material: PDF bytes, or plain text (URL-extracted and cached, or a local .md/.txt). */
async function resolveSource(ctx: Ctx): Promise<{ text?: string; pdfBase64?: string }> {
  if (ctx.inputKind === "pdf") {
    return { pdfBase64: readFileSync(ctx.input).toString("base64") };
  }
  if (ctx.inputKind === "arxiv") {
    return { pdfBase64: (await fetchArxivPdf(ctx)).toString("base64") };
  }
  if (ctx.inputKind === "text") {
    return { text: readFileSync(ctx.input, "utf8") };
  }
  const cached = paths.sourceText(ctx);
  if (existsSync(cached) && !ctx.force) {
    info("ingest", `using cached extraction ${cached}`);
    return { text: readFileSync(cached, "utf8") };
  }
  info("ingest", `fetching and extracting ${ctx.input}`);
  const text = await fetchArticleText(ctx.input);
  mkdirSync(ctx.workDir, { recursive: true });
  writeFileSync(cached, text);
  info("ingest", `cached extraction to ${cached}`);
  return { text };
}

export async function runIngest(ctx: Ctx): Promise<ConceptMap> {
  emit(ctx.onEvent, { type: "stage-start", stage: "ingest" });
  mkdirSync(ctx.workDir, { recursive: true });
  const source = await resolveSource(ctx);

  const promptRaw = loadPromptRaw("ingest");
  const sourceForHash = source.text ?? source.pdfBase64!;
  const hash = stageHash({
    artifacts: [sourceForHash, ctx.audienceRaw, String(ctx.maxScenes ?? "uncapped")],
    prompt: promptRaw,
    model: MODELS.planning,
  });
  const hashFile = paths.stageHashFile(ctx, "ingest");
  const out = paths.conceptMap(ctx);

  if (!ctx.force && isFresh(hashFile, hash, [out])) {
    info("ingest", "cache hit — skipping");
    const cached = ConceptMapSchema.parse(JSON.parse(readFileSync(out, "utf8")));
    emit(ctx.onEvent, { type: "ingest-done", concepts: cached.concepts.length });
    return cached;
  }

  const prompt = loadPrompt("ingest", {
    audience: ctx.audienceRaw,
    conceptBudget: ctx.maxScenes
      ? `at most ${ctx.maxScenes + 2} concepts`
      : "the concepts the ladder needs — typically 8–12 for a dense paper",
  });

  const content: Anthropic.ContentBlockParam[] = [];
  if (source.pdfBase64) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: source.pdfBase64 },
    });
  } else {
    content.push({ type: "text", text: `SOURCE ARTICLE:\n\n${source.text}` });
  }
  content.push({ type: "text", text: prompt });

  info("ingest", `building concept map with ${MODELS.planning}`);
  // Long-context calls (a whole PDF in the prompt) occasionally end mid-output;
  // an incomplete JSON response is retried, not fatal.
  const MAX_ATTEMPTS = 3;
  let parsed: unknown;
  for (let attempt = 1; ; attempt++) {
    const raw = await callModel({
      model: MODELS.planning,
      messages: [{ role: "user", content }],
      // Dense papers (long PDFs, deep prerequisite ladders) can exceed 8k output tokens.
      maxTokens: 16000,
    });
    try {
      parsed = JSON.parse(stripJsonFences(raw));
      break;
    } catch {
      writeFileSync(out + ".raw.txt", raw);
      if (attempt >= MAX_ATTEMPTS) {
        throw new StageError(
          "ingest",
          `model did not return valid JSON after ${MAX_ATTEMPTS} attempts (raw response saved)`,
          out + ".raw.txt"
        );
      }
      warn("ingest", `attempt ${attempt}: response was not valid JSON (${raw.length} chars) — retrying`);
    }
  }
  const result = ConceptMapSchema.safeParse(parsed);
  if (!result.success) {
    writeFileSync(out + ".invalid", JSON.stringify(parsed, null, 2));
    throw new StageError(
      "ingest",
      `concept map failed schema validation: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      out + ".invalid"
    );
  }
  let map = result.data;
  if (ctx.maxScenes && map.concepts.length > ctx.maxScenes + 2) {
    warn("ingest", `model returned ${map.concepts.length} concepts; keeping top ${ctx.maxScenes + 2}`);
    map = { ...map, concepts: map.concepts.slice(0, ctx.maxScenes + 2) };
  }

  writeFileSync(out, JSON.stringify(map, null, 2));
  recordHash(hashFile, hash);
  info("ingest", `wrote ${out} (${map.concepts.length} concepts)`);
  emit(ctx.onEvent, { type: "ingest-done", concepts: map.concepts.length });
  return map;
}
