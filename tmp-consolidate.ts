// Migration: fold audience.json into storyboard.md for a live repo dir.
// Asserts round-trip AND per-scene contractHash equality before writing.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { AudienceProfileSchema } from "./src/lib/schemas.js";
import { storyboardToMarkdown, parseStoryboardMarkdown, roundTripCheck } from "./src/lib/storyboard-md.js";
import { contractHash } from "./src/lib/lockfile.js";
import { readLock } from "./src/lib/lockfile.js";
import type { Ctx } from "./src/lib/context.js";

const dir = resolve(process.argv[2]!);
const audience = AudienceProfileSchema.parse(JSON.parse(readFileSync(join(dir, "audience.json"), "utf8")));
const oldMd = readFileSync(join(dir, "storyboard.md"), "utf8");

// Inject the Audience section right before the first "## Part:" heading.
const audienceBlock =
  `## Audience\n\nBackground: ${audience.background}\n\nAssume known:\n` +
  audience.assumeKnown.map((s) => `- ${s}`).join("\n") +
  `\n\nDo not assume:\n` +
  audience.doNotAssume.map((s) => `- ${s}`).join("\n") +
  `\n\nTone: ${audience.tone}\n\n`;
const idx = oldMd.indexOf("## Part: ");
if (idx < 0) throw new Error("no '## Part:' heading found");
const combined = oldMd.slice(0, idx) + audienceBlock + oldMd.slice(idx);

const doc = parseStoryboardMarkdown(combined);
roundTripCheck(doc.storyboard, doc.audience);
if (JSON.stringify(doc.audience) !== JSON.stringify(audience)) throw new Error("audience drift");

// contract hashes must be unchanged vs the lockfile (proves zero regeneration)
const ctx = { audience: doc.audience, audienceRaw: JSON.stringify(doc.audience, null, 2) } as Ctx;
const lock = readLock(dir);
for (const scene of doc.storyboard.scenes) {
  if (lock.scenes[scene.id]!.contractHash !== contractHash(ctx, scene)) {
    throw new Error(`contractHash drift on ${scene.id}`);
  }
}
writeFileSync(join(dir, "storyboard.md"), storyboardToMarkdown(doc.storyboard, doc.audience));
console.log(`${dir}: consolidated (${doc.storyboard.scenes.length} scenes, hashes verified unchanged)`);
