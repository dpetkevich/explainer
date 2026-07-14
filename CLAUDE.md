# explain-it — agent guidance

Turn a paper (arXiv URL, PDF, or article) into an interactive HTML explainer. The pipeline is a
team of model-driven agents; **the prompts in `prompts/*.md` are their guidance and the product's
tuning surface**. All pedagogy rules live there, not in code. When the user gives feedback about
explanation quality, generalize it into the relevant prompt so every future paper inherits it.

## The agents and where their guidance lives

| Agent | Model (default) | Guidance file | Job |
|---|---|---|---|
| Analyst | `claude-fable-5` | `prompts/ingest.md` | PDF/article → concept map, incl. `foundational: true` first-principles rungs |
| Scriptwriter | `claude-fable-5` | `prompts/storyboard.md` | concept map → script (parts, ledes, captions, scene specs, physics checks) |
| Developer | `claude-sonnet-5` | `prompts/scene.md` | scene spec → standalone interactive HTML |
| Reviewer | `claude-sonnet-5` | `prompts/review.md` | two screenshots → pass/fail with failure kinds |
| Repairer | `claude-sonnet-5` | `prompts/repair.md` | failed scene + review findings → fixed HTML |

Models are overridable via `PLANNING_MODEL`, `CODEGEN_MODEL`, `REVIEW_MODEL`.

## Pedagogy principles (all user-taught; do not weaken)

In `prompts/storyboard.md`:
- Fixed four-section arc: building blocks → the new technology → why it beats existing tech → why now; every part lede states what it builds on.
- Feynman-first refresher scenes (`requires: []`) even when `assumeKnown` technically covers them.
- Atomicity: one idea per scene; mechanism vs full-scale payoff = two scenes (toy example first); multi-step process = one scene per step; every scene opens by naming the need it answers.
- Feynman voice with Zinsser economy; plain idiomatic English (read-aloud test).
- No undefined terms anywhere (hook, ledes, titles included); introduce-then-use (metaphor → proper term, then the proper term); sustained metaphors declared explicitly with their mapping.
- Mechanisms must be cashed out in a concrete miniature example; when a taught mechanism reappears at a new scale, map each ingredient onto the new actors.
- Story roles beat algebra labels ("you", "your friend", never "atom A", "B's half").
- A metaphor must survive the reader's arithmetic; when the WHY is beyond the audience, teach the verified contract (with a "try to cheat" control); when even that is too much, declare an honest black box with cost + guarantees.
- Caption math in `\( ... \)` (never `$` — captions contain currency); simple declarative titles.

In `prompts/scene.md`: no clipped text at any edge; MathML equations with a symbol legend; every plot element labeled in plain words; no bare abbreviations; control captions say what they do; instant-completing sequences (QA screenshots the end state); no reset-dependent state.

In `prompts/review.md`: review on behalf of the injected audience profile, not the author; edge sweep first; first-time reader test (mechanism named-but-not-shown fails); `comprehension` is a first-class failure kind.

## Workflow essentials

- `npx tsx src/cli.ts <arxiv-url|pdf|md|url> [--audience profiles/X.json]` — stops at the **script gate** after the storyboard; present `work/script.md` to the user before generating graphics.
- Audience profiles: `profiles/default.json` (Yale physics undergrad), `profiles/smart-layperson.json` (no physics beyond high school). Changing the audience invalidates all caches by design.
- Caches: every stage hashed on inputs (see `src/lib/cache.ts`). Scene hashes cover only the **scene contract** (`sceneContract()` in `src/stages/scenes.ts`: visualMetaphor, animatedVariable, physicsChecks, quantitativeAnchor) — prose fields (title, teaches, caption, part, requires) render outside the scene HTML and **never invalidate graphics**; edit them freely and just reassemble. Spec (contract) edits DO regenerate the scene, by design.
- Editing any `prompts/*.md` invalidates the corresponding stage hashes everywhere — re-record hashes for already-accepted artifacts after prompt-rule changes (protect shipped work; new work faces the new rules).
- Failed scenes: prefer fixing the SPEC (add an implementation requirement naming the failure) over trusting the repair loop — spec-fix-then-regenerate has passed first-try nearly every time.
- Planning models think: `max_tokens` must budget for extended thinking (ingest 16k, storyboard/codegen/repair 64k). Long-context calls occasionally return truncated/empty JSON — stages retry ×3.
- Assemble is deterministic and instant; `explainer.html` is a single self-contained file, served directly by the web app.

## Web app (self-serve)

One always-on Node/Fastify service (`src/server/`, run with `npm run serve`) turns the
pipeline into a self-serve product: anyone uploads a paper (PDF or arXiv/URL) and watches
it generate live; readers post anonymous comments. There is **no GitHub integration** —
generation, storage, and hosting all live in this one service.
- `index.ts` — routes: `POST /api/uploads`, `GET /api/explainers` (feed), `GET /api/explainers/:id/events` (SSE progress), `GET /api/explainers/:id/html` (the finished explainer), `GET|POST …/comments`, and the `/` + `/explainer/:id` frontend (`src/server/public/`).
- `queue.ts` + `jobs.ts` — in-process job queue (concurrency `GEN_CONCURRENCY`, default 1) runs the pipeline stages directly (so the CLI's script gate never applies) with a fixed default audience (`AUDIENCE_PROFILE`, default `profiles/default.json`).
- Live progress is the additive `ProgressEvent` layer: `src/lib/progress.ts` + `Ctx.onEvent`, emitted next to the existing `info()` sites in ingest/storyboard/pipeline/qa/assemble. The job's `onEvent` updates the SQLite row and fans out to SSE.
- `db.ts` — SQLite (`better-sqlite3`) at `data/explainers.db`: explainer records + comments. On boot, `running` jobs are marked failed and `queued` jobs resume.
- `limits.ts` — per-IP rate limits, 25 MB PDF cap, global daily generation cap. Model refusals become a typed `RefusalError` → clean `failed: content declined`.
- Deploy as one container on a long-job host (Playwright base image for Chromium), `ANTHROPIC_API_KEY` set, a persistent volume at `data/` **and** `explainers/` (artifacts). Not Vercel — jobs are long and need a browser.

## Testing

No test suite yet. Verification = `npx tsc --noEmit`, then a pipeline run: all scenes pass QA and a rerun is a full cache no-op.
