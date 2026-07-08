import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import type Anthropic from "@anthropic-ai/sdk";
import { callModel, MODELS, stripJsonFences, extractHtml } from "../lib/anthropic.js";
import { stageHash, isFresh, recordHash } from "../lib/cache.js";
import { loadPrompt, loadPromptRaw } from "../lib/prompts.js";
import { QaReportSchema, type StoryboardScene, type QaReport } from "../lib/schemas.js";
import { info, warn, StageError } from "../lib/log.js";
import { paths, type Ctx } from "../lib/context.js";

const MAX_REPAIRS = 2;
const READY_TIMEOUT_MS = 10_000;

export interface SceneResult {
  id: string;
  status: "pass" | "fail";
  attempts: number;
  failures?: QaReport["failures"];
  consoleErrors?: string[];
}

export interface QaSummary {
  scenes: SceneResult[];
}

interface RenderResult {
  consoleErrors: string[];
  consoleWarnings: string[];
  defaultPng: Buffer;
  perturbedPng: Buffer;
}

async function renderScene(browser: Browser, htmlPath: string): Promise<RenderResult> {
  const page: Page = await browser.newPage({ viewport: { width: 680, height: 800 } });
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
    else if (msg.type() === "warning") consoleWarnings.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  try {
    await page.goto(pathToFileURL(htmlPath).href);
    try {
      await page.waitForFunction("window.__sceneReady === true", null, { timeout: READY_TIMEOUT_MS });
    } catch {
      consoleErrors.push(`window.__sceneReady was not set within ${READY_TIMEOUT_MS / 1000}s`);
    }
    await page.waitForTimeout(400); // let the first animation frames land
    const defaultPng = await page.screenshot({ fullPage: true });

    // Perturb: sliders to max, selects to last option, one click per button.
    await page.evaluate(() => {
      document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((el) => {
        el.value = el.max || "100";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      document.querySelectorAll<HTMLSelectElement>("select").forEach((el) => {
        if (el.options.length > 1) {
          el.selectedIndex = el.options.length - 1;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
    for (const button of await page.locator("button").all()) {
      // Don't undo the perturbation we just made: a reset/clear button clicked
      // last restores the default state and makes the scene look inert.
      const label = ((await button.textContent().catch(() => "")) ?? "").trim();
      if (/reset|clear|restart|undo/i.test(label)) continue;
      await button.click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(700); // let the perturbed state render
    const perturbedPng = await page.screenshot({ fullPage: true });

    return { consoleErrors, consoleWarnings, defaultPng, perturbedPng };
  } finally {
    await page.close();
  }
}

async function reviewScene(
  scene: StoryboardScene,
  render: RenderResult
): Promise<QaReport> {
  const prompt = loadPrompt("review", {
    scene: JSON.stringify(scene, null, 2),
    consoleWarnings: render.consoleWarnings.length
      ? render.consoleWarnings.join("\n")
      : "(none)",
  });
  const image = (png: Buffer): Anthropic.ImageBlockParam => ({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
  });
  const raw = await callModel({
    model: MODELS.review,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Screenshot 1 — default control state:" },
          image(render.defaultPng),
          { type: "text", text: "Screenshot 2 — after moving every slider to max and clicking each button once:" },
          image(render.perturbedPng),
          { type: "text", text: prompt },
        ],
      },
    ],
    // Reviews are small JSON, but a verbose reviewer that hits the cap produces
    // unparseable output and falsely fails the scene — leave generous headroom.
    maxTokens: 8000,
  });
  let json: unknown;
  try {
    json = JSON.parse(stripJsonFences(raw));
  } catch {
    throw new StageError("qa", `reviewer did not return valid JSON: ${raw.slice(-200)}`, undefined, scene.id);
  }
  const parsed = QaReportSchema.safeParse(json);
  if (!parsed.success) {
    throw new StageError("qa", `reviewer returned invalid QaReport: ${parsed.error.message}`, undefined, scene.id);
  }
  return parsed.data;
}

async function repairScene(
  ctx: Ctx,
  scene: StoryboardScene,
  currentHtml: string,
  problems: string
): Promise<void> {
  const sceneContract = loadPrompt("scene", {
    scene: JSON.stringify(scene, null, 2),
    audience: ctx.audienceRaw,
    sceneId: scene.id,
  });
  const prompt = loadPrompt("repair", {
    problems,
    currentHtml,
    sceneContract,
  });
  const raw = await callModel({
    model: MODELS.codegen,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 32000,
  });
  const html = extractHtml(raw);
  if (!/<!doctype html>/i.test(html)) {
    throw new StageError("qa", "repair did not return a complete HTML document", paths.sceneHtml(ctx, scene.id), scene.id);
  }
  writeFileSync(paths.sceneHtml(ctx, scene.id), html);
}

export async function qaOneScene(ctx: Ctx, browser: Browser, scene: StoryboardScene): Promise<SceneResult> {
  const htmlPath = paths.sceneHtml(ctx, scene.id);
  if (!existsSync(htmlPath)) {
    throw new StageError("qa", "scene HTML not found — run the scenes stage first", htmlPath, scene.id);
  }

  const hashFile = paths.qaHash(ctx, scene.id);
  const reportPath = paths.qaReport(ctx, scene.id);
  // Note: hash covers the scene HTML as it was *before* QA; repairs rewrite the
  // HTML and re-record, so a passing repaired scene stays cached.
  const forced = ctx.force || ctx.onlyScene === scene.id;

  let attempts = 0;
  let lastFailures: QaReport["failures"] = [];
  let lastConsoleErrors: string[] = [];

  while (attempts <= MAX_REPAIRS) {
    const html = readFileSync(htmlPath, "utf8");
    const hash = stageHash({
      artifacts: [html, JSON.stringify(scene)],
      prompt: loadPromptRaw("review") + loadPromptRaw("repair"),
      model: MODELS.review,
    });
    if (!forced && attempts === 0 && isFresh(hashFile, hash, [reportPath])) {
      const prior = JSON.parse(readFileSync(reportPath, "utf8")) as SceneResult;
      info("qa", `${scene.id}: cache hit — ${prior.status}`);
      return prior;
    }

    info("qa", `${scene.id}: rendering (attempt ${attempts + 1}/${MAX_REPAIRS + 1})`);
    const render = await renderScene(browser, htmlPath);
    writeFileSync(paths.qaDefaultPng(ctx, scene.id), render.defaultPng);
    writeFileSync(paths.qaPerturbedPng(ctx, scene.id), render.perturbedPng);

    let failureText: string | null = null;
    if (render.consoleErrors.length > 0) {
      lastConsoleErrors = render.consoleErrors;
      failureText = `Console errors while running the scene:\n${render.consoleErrors.join("\n")}`;
      info("qa", `${scene.id}: ${render.consoleErrors.length} console error(s) — skipping vision review`);
    } else {
      const report = await reviewScene(scene, render);
      if (report.pass) {
        const result: SceneResult = { id: scene.id, status: "pass", attempts: attempts + 1 };
        writeFileSync(reportPath, JSON.stringify(result, null, 2));
        const finalHash = stageHash({
          artifacts: [readFileSync(htmlPath, "utf8"), JSON.stringify(scene)],
          prompt: loadPromptRaw("review") + loadPromptRaw("repair"),
          model: MODELS.review,
        });
        recordHash(hashFile, finalHash);
        info("qa", `${scene.id}: PASS`);
        return result;
      }
      lastFailures = report.failures;
      failureText =
        "The visual reviewer found these failures:\n" +
        report.failures.map((f) => `- [${f.kind}] ${f.detail}`).join("\n");
      info("qa", `${scene.id}: review failed (${report.failures.map((f) => f.kind).join(", ")})`);
    }

    attempts++;
    if (attempts > MAX_REPAIRS) break;
    info("qa", `${scene.id}: repairing (${attempts}/${MAX_REPAIRS})`);
    await repairScene(ctx, scene, readFileSync(htmlPath, "utf8"), failureText);
  }

  const result: SceneResult = {
    id: scene.id,
    status: "fail",
    attempts,
    failures: lastFailures.length ? lastFailures : undefined,
    consoleErrors: lastConsoleErrors.length ? lastConsoleErrors : undefined,
  };
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  warn("qa", `${scene.id}: FAILED after ${MAX_REPAIRS} repairs — will be excluded from the explainer (${reportPath})`);
  return result;
}
