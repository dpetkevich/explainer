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
- **Visuals carry the explanation**: an explainer should nearly stand on its diagrams, charts, and equations alone; words are connective tissue and the hardest part to absorb, so use as few as possible. Whenever a sentence could be drawn instead, draw it.
- Every scene is a **labeled diagram** (structural concepts — name the parts, draw the connections) or an **interactive chart** (relationships — plot it, put the independent variable on a reader-moved control). Push meaning into labels/annotations/axes.
- Captions are **1–2 short sentences** that name the need and point at the visual — not paragraphs. Keep every number. Feynman warmth, Zinsser economy, read-aloud test.
- Fixed four-section arc: building blocks → the new technology → why it beats existing tech → why now; every part lede states what it builds on.
- Feynman-first refresher scenes (`requires: []`) even when `assumeKnown` technically covers them.
- Atomicity: one idea per scene; mechanism vs full-scale payoff = two scenes (toy example first); multi-step process = one scene per step; every scene opens by naming the need it answers.
- No undefined terms anywhere (hook, ledes, titles included). **A metaphor is a doorway, not a residence**: open a concept with a one-line metaphor if useful, then name the proper term and drop the metaphor — never sustain it across a scene.
- A metaphor must survive the reader's arithmetic; when the WHY is beyond the audience, teach the verified contract (with a "try to cheat" control); when even that is too much, declare an honest black box with cost + guarantees.
- Caption math in `\( ... \)` (never `$` — captions contain currency); simple declarative titles.

In `prompts/scene.md`: the drawing must stand on its own labels (caption is minimal) — name every part, label every axis/curve, annotate the values that matter; no clipped text at any edge; MathML equations with a symbol legend; no bare abbreviations; control captions say what they do; instant-completing sequences (QA screenshots the end state); no reset-dependent state.

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

A Fastify web app (`src/server/`, run locally with `npm run serve`) serves a read-only gallery of
**pre-computed** explainers plus reader interactions (browse/filter, star, comment, "chat with this
paper"). Generation is **offline** (the `scripts/regen-*.ts` drivers call `runGenerationJob`), so the
served app never runs the pipeline or a browser and deploys as one Vercel serverless function. There
is **no GitHub integration** and **no in-app upload/generation**.
- `app.ts` — builds+exports the Fastify app (no listen). Routes: `GET /api/explainers` (feed), `GET /api/explainers/:id` + `…/html`, `GET|POST …/comments`, `POST …/star`, `POST …/chat` + `GET …/chats`, and the `/` + `/explainer/:id` frontend (`src/server/public/`). `index.ts` is the local bootstrap (`initDb` + listen); `api/index.ts` wraps `app` as the Vercel handler. No SSE route (explainers are always done).
- `jobs.ts` — `runGenerationJob` runs the pipeline stages directly for the offline drivers (imports Playwright, so it is **never** imported by `app.ts`). `sse.ts`/`ProgressEvent` (`src/lib/progress.ts`) still fire during local generation as best-effort DB progress updates.
- `db.ts` — **Postgres** via `@vercel/postgres` (async), one datastore for serving and local generation, selected by `POSTGRES_URL` (Vercel Postgres/Neon in prod; a Neon branch locally — there is no `file:` mode). `scripts/migrate-to-postgres.ts` seeds it from the old local SQLite.
- `limits.ts` — per-IP rate limits (in-memory → best-effort per serverless instance). Model refusals become a typed `RefusalError` → clean `failed: content declined`.
- Deploy: **Vercel**. `vercel.json` routes everything to `api/index.ts`, `includeFiles` bundles the committed artifacts (`explainers/*/explainer.html` + `work/{concept-map,storyboard,source.md}.json`) + `prompts/` + `profiles/` + `public/`, and sets `maxDuration: 60` for chat (fable-5 runs 10–40s+ → needs Vercel **Pro**). `playwright` is a devDependency; set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the Vercel env. Env: `POSTGRES_URL`, `ANTHROPIC_API_KEY`, `AUDIENCE_PROFILE`.

## Testing

No test suite yet. Verification = `npx tsc --noEmit`, then a pipeline run: all scenes pass QA and a rerun is a full cache no-op.
