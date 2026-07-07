import { join } from "node:path";
import type { AudienceProfile } from "./schemas.js";

export type InputKind = "pdf" | "url" | "text";

export interface Ctx {
  /** Original input argument (path or URL). */
  input: string;
  inputKind: InputKind;
  outDir: string;
  workDir: string;
  audience: AudienceProfile;
  /** Audience profile as pretty JSON, injected verbatim into prompts. */
  audienceRaw: string;
  maxScenes: number;
  force: boolean;
  /** When set, scenes/qa run for this scene only (with force). */
  onlyScene?: string;
}

export const paths = {
  sourceText: (c: Ctx) => join(c.workDir, "source.md"),
  conceptMap: (c: Ctx) => join(c.workDir, "concept-map.json"),
  storyboard: (c: Ctx) => join(c.workDir, "storyboard.json"),
  sceneHtml: (c: Ctx, id: string) => join(c.workDir, "scenes", `${id}.html`),
  sceneHash: (c: Ctx, id: string) => join(c.workDir, "scenes", `${id}.hash`),
  qaDir: (c: Ctx) => join(c.workDir, "qa"),
  qaDefaultPng: (c: Ctx, id: string) => join(c.workDir, "qa", `${id}.default.png`),
  qaPerturbedPng: (c: Ctx, id: string) => join(c.workDir, "qa", `${id}.perturbed.png`),
  qaReport: (c: Ctx, id: string) => join(c.workDir, "qa", `${id}.report.json`),
  qaHash: (c: Ctx, id: string) => join(c.workDir, "qa", `${id}.hash`),
  qaSummary: (c: Ctx) => join(c.workDir, "qa", "summary.json"),
  stageHashFile: (c: Ctx, stage: string) => join(c.workDir, `${stage}.hash`),
  explainer: (c: Ctx) => join(c.outDir, "explainer.html"),
};
