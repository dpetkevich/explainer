/**
 * storyboard.md — the single human-readable AND machine-parseable source of an
 * explanation. It reads like the script (title, hook, parts, captions) and
 * carries every field that generates the HTML (visuals, interactives, checks).
 *
 * The format is line-anchored: field labels are recognized only at the start
 * of a line, in a fixed order within each scene. serialize→parse is an exact
 * round-trip (enforced by roundTripCheck), so tooling can rewrite the file
 * without drift.
 */
import { StoryboardSchema, AudienceProfileSchema, type Storyboard, type StoryboardScene, type AudienceProfile } from "./schemas.js";
import { StageError } from "./log.js";

const CONTROL_VALUES = ["slider", "buttons", "toggle", "play-pause"] as const;

// ---------------------------------------------------------------- serialize

export function storyboardToMarkdown(board: Storyboard, audience: AudienceProfile): string {
  const lines: string[] = [];
  lines.push(`# ${board.title}`, "");
  lines.push(`Hook: ${board.hook}`, "");
  lines.push(`## Audience`, "");
  lines.push(`Background: ${audience.background}`, "");
  lines.push(`Assume known:`);
  for (const item of audience.assumeKnown) lines.push(`- ${item}`);
  lines.push("");
  lines.push(`Do not assume:`);
  for (const item of audience.doNotAssume) lines.push(`- ${item}`);
  lines.push("");
  lines.push(`Tone: ${audience.tone}`, "");

  const ledes = new Map((board.parts ?? []).map((p) => [p.title, p.lede]));
  let currentPart: string | undefined;

  for (const scene of board.scenes) {
    if (scene.part !== undefined && scene.part !== currentPart) {
      currentPart = scene.part;
      lines.push(`## Part: ${scene.part}`, "");
      const lede = ledes.get(scene.part);
      if (lede !== undefined) lines.push(`Lede: ${lede}`, "");
    }
    lines.push(`### ${scene.title} {#${scene.id}}`, "");
    lines.push(`- concept: ${scene.conceptId}`);
    lines.push(`- requires: ${scene.requires.length ? scene.requires.join(", ") : "none"}`, "");
    lines.push(`Teaches: ${scene.teaches}`, "");
    lines.push(`Caption: ${scene.caption}`, "");
    lines.push(`Visual: ${scene.visualMetaphor}`, "");
    lines.push("Interactive:");
    lines.push(`- variable: ${scene.animatedVariable.name}`);
    lines.push(`- control: ${scene.animatedVariable.control}`);
    lines.push(`- range: ${scene.animatedVariable.range}`);
    lines.push(`- on-screen: ${scene.animatedVariable.whatChangesOnScreen}`, "");
    if (scene.quantitativeAnchor !== undefined) {
      lines.push(`Anchor: ${scene.quantitativeAnchor}`, "");
    }
    lines.push("Checks:");
    for (const check of scene.physicsChecks) lines.push(`- ${check}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------- parse

class Parser {
  private i = 0;
  constructor(private lines: string[]) {}

  fail(msg: string): never {
    throw new StageError("storyboard.md", `line ${this.i + 1}: ${msg}`);
  }
  peek(): string | undefined {
    return this.lines[this.i];
  }
  next(): string | undefined {
    return this.lines[this.i++];
  }
  skipBlank(): void {
    while (this.i < this.lines.length && this.lines[this.i]!.trim() === "") this.i++;
  }
  atEnd(): boolean {
    this.skipBlank();
    return this.i >= this.lines.length;
  }
  /** Consume a `Label: value` line where the value may wrap onto following lines until a blank line. */
  labeled(label: string): string {
    this.skipBlank();
    const line = this.peek();
    if (line === undefined || !line.startsWith(`${label}: `)) {
      this.fail(`expected "${label}: …", found ${line === undefined ? "end of file" : JSON.stringify(line.slice(0, 60))}`);
    }
    this.next();
    let value = line.slice(label.length + 2);
    while (this.peek() !== undefined && this.peek()!.trim() !== "" && !this.isStructural(this.peek()!)) {
      value += " " + this.next()!.trim();
    }
    return value.trim();
  }
  isStructural(line: string): boolean {
    return /^(#{1,3} |- |Hook: |Lede: |Teaches: |Caption: |Visual: |Interactive:|Anchor: |Checks:|Background: |Tone: |Assume known:|Do not assume:)/.test(line);
  }
  bullet(prefix?: string): string | undefined {
    this.skipBlank();
    const line = this.peek();
    if (line === undefined || !line.startsWith("- ")) return undefined;
    const body = line.slice(2);
    if (prefix !== undefined) {
      if (!body.startsWith(`${prefix}: `)) this.fail(`expected "- ${prefix}: …", found ${JSON.stringify(line.slice(0, 60))}`);
      this.next();
      return body.slice(prefix.length + 2).trim();
    }
    this.next();
    return body.trim();
  }
}

export interface ParsedStoryboardDoc {
  storyboard: Storyboard;
  audience: AudienceProfile;
}

export function parseStoryboardMarkdown(text: string): ParsedStoryboardDoc {
  const p = new Parser(text.split("\n"));

  p.skipBlank();
  const titleLine = p.next();
  if (!titleLine?.startsWith("# ")) throw new StageError("storyboard.md", `line 1: expected "# <explainer title>"`);
  const title = titleLine.slice(2).trim();
  const hook = p.labeled("Hook");

  p.skipBlank();
  if (p.peek() !== "## Audience") {
    throw new StageError("storyboard.md", `expected "## Audience" section after the hook`);
  }
  p.next();
  const background = p.labeled("Background");
  p.skipBlank();
  if (p.peek() !== "Assume known:") throw new StageError("storyboard.md", `expected "Assume known:" in the Audience section`);
  p.next();
  const assumeKnown: string[] = [];
  for (let b = p.bullet(); b !== undefined; b = p.bullet()) assumeKnown.push(b);
  p.skipBlank();
  if (p.peek() !== "Do not assume:") throw new StageError("storyboard.md", `expected "Do not assume:" in the Audience section`);
  p.next();
  const doNotAssume: string[] = [];
  for (let b = p.bullet(); b !== undefined; b = p.bullet()) doNotAssume.push(b);
  const tone = p.labeled("Tone");
  const audience = AudienceProfileSchema.parse({ background, assumeKnown, doNotAssume, tone });

  const parts: { title: string; lede: string }[] = [];
  const scenes: StoryboardScene[] = [];
  let currentPart: string | undefined;

  while (!p.atEnd()) {
    const line = p.peek()!;
    if (line.startsWith("## Part: ")) {
      p.next();
      currentPart = line.slice("## Part: ".length).trim();
      const lede = p.labeled("Lede");
      parts.push({ title: currentPart, lede });
      continue;
    }
    const sceneHead =
      line.match(/^### (.*) \{#([a-z0-9-]+)\}$/) ??
      p.fail(`expected "## Part: …" or "### <scene title> {#scene-id}", found ${JSON.stringify(line.slice(0, 70))}`);
    p.next();
    const sceneTitle = sceneHead[1]!.trim();
    const id = sceneHead[2]!;

    const conceptId = p.bullet("concept") ?? p.fail(`scene "${id}": expected "- concept: …"`);
    const requiresRaw = p.bullet("requires") ?? p.fail(`scene "${id}": expected "- requires: …"`);
    const requires = requiresRaw === "none" ? [] : requiresRaw.split(",").map((s) => s.trim()).filter(Boolean);

    const teaches = p.labeled("Teaches");
    const caption = p.labeled("Caption");
    const visualMetaphor = p.labeled("Visual");

    p.skipBlank();
    if (p.peek() !== "Interactive:") p.fail(`scene "${id}": expected "Interactive:"`);
    p.next();
    const name = p.bullet("variable") ?? p.fail(`scene "${id}": expected "- variable: …"`);
    const control = p.bullet("control") ?? p.fail(`scene "${id}": expected "- control: …"`);
    if (!(CONTROL_VALUES as readonly string[]).includes(control)) {
      p.fail(`scene "${id}": control must be one of ${CONTROL_VALUES.join(" | ")}, got "${control}"`);
    }
    const range = p.bullet("range") ?? p.fail(`scene "${id}": expected "- range: …"`);
    const whatChangesOnScreen = p.bullet("on-screen") ?? p.fail(`scene "${id}": expected "- on-screen: …"`);

    p.skipBlank();
    let quantitativeAnchor: string | undefined;
    if (p.peek()?.startsWith("Anchor: ")) quantitativeAnchor = p.labeled("Anchor");

    p.skipBlank();
    if (p.peek() !== "Checks:") p.fail(`scene "${id}": expected "Checks:"`);
    p.next();
    const physicsChecks: string[] = [];
    for (let c = p.bullet(); c !== undefined; c = p.bullet()) physicsChecks.push(c);

    scenes.push({
      id,
      conceptId,
      part: currentPart,
      title: sceneTitle,
      teaches,
      requires,
      caption,
      visualMetaphor,
      animatedVariable: { name, control: control as StoryboardScene["animatedVariable"]["control"], range, whatChangesOnScreen },
      quantitativeAnchor,
      physicsChecks,
    });
  }

  return {
    storyboard: StoryboardSchema.parse({ title, hook, parts: parts.length ? parts : undefined, scenes }),
    audience,
  };
}

/** Serialize→parse must reproduce the exact same storyboard + audience. */
export function roundTripCheck(board: Storyboard, audience: AudienceProfile): void {
  const again = parseStoryboardMarkdown(storyboardToMarkdown(board, audience));
  if (JSON.stringify(board) !== JSON.stringify(again.storyboard) || JSON.stringify(audience) !== JSON.stringify(again.audience)) {
    throw new StageError("storyboard.md", "round-trip mismatch — the document contains text this format cannot carry");
  }
}
