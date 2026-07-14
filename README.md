# explain-it

Turn a scientific paper (PDF) or technical article (URL) into a single self-contained, scrollable HTML explainer in which each core concept is taught through an interactive HTML/SVG/canvas animation — sliders, toggles, live physics — not video.

## Two ways to run it

**Web app (self-serve):** `npm run serve` starts a single always-on Fastify service where
anyone uploads a paper (PDF or arXiv/URL) and watches it generate live — a global feed with
per-scene status — then reads the result and posts anonymous comments. Generation runs as
in-process background jobs (SQLite-backed, live progress over SSE) with per-IP rate limits and
a daily cap. See `src/server/` and the "Web app" section of `CLAUDE.md`. Deploy as one
container on a long-job host (needs Chromium + `ANTHROPIC_API_KEY` + a persistent `data/` and
`explainers/` volume).

**CLI (local):** `npx tsx src/cli.ts <paper>` runs the same pipeline locally, with a
script-review gate (below). Useful for development and one-off runs.

Both paths produce the same single self-contained `explainer.html`.

## Setup

```bash
npm install
npx playwright install chromium   # one-time, needed for the QA stage
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```bash
npx tsx src/cli.ts <paper.pdf | https://url | notes.md> [options]

  --out <dir>          output directory (default: ./explainers/<slug>/)
  --audience <file>    audience profile JSON (default: ./profiles/default.json)
  --reader <text>      override the audience background for this run
  --max-scenes <n>     optional cap on scenes (default: as many as the storyboard needs)
  --stage <name>       run up to: ingest | storyboard | scenes | qa | assemble
  --scene <id>         regenerate a single scene by id, then re-run qa + assemble
  --force              ignore cache for the requested stage(s)
  --yes                skip the script review gate and run straight through
  --open               open the finished explainer in the default browser
```

The final deliverable is `<out>/explainer.html` — one file, zero network dependencies, works from `file://`, light and dark mode.

## Script review gate

The first run stops after the storyboard and writes a human-readable script to `<out>/work/script.md` — title, hook, and per scene: the one idea it teaches, what it builds on, the caption, the interactive control, and the physics checks. Review it before paying for any graphics:

- happy → rerun the same command; the cached storyboard passes the gate and scenes + QA run.
- tweak → edit `<out>/work/storyboard.json` by hand (it is re-validated and the script re-rendered on every load), then rerun.
- reject → rerun with `--force` to regenerate the storyboard.
- skip → `--yes` runs straight through on the first pass.

## Audience

The reader is described by a profile JSON (`background`, `assumeKnown`, `doNotAssume`, `tone`). The default is a Yale physics undergrad (`profiles/default.json`). For a one-off change, `--reader "high-school student"` overrides just the background; for a recurring audience, add another file to `profiles/` and pass `--audience`. The storyboard ramp rule keys off the profile: scene 1 must be understandable from `assumeKnown` alone, so a less advanced reader automatically gets a longer intro ramp.

## Pipeline

```
input → [ingest] concept-map.json → [storyboard] storyboard.json + script.md
      → ‖ review gate ‖                 (first run stops here; see above)
      → [scenes+qa] per-scene pipeline: generate → render → vision review → repair (max 2)
      → [assemble] explainer.html        (deterministic templating, no model)
```

Scenes are pipelined: 4 workers each take a scene end-to-end (generate → render → review → repair) over a shared headless browser, so wall time is roughly the slowest single scene chain, not the sum of a scenes stage plus a QA stage. Each stage logs its wall time.

Every intermediate artifact lives in `<out>/work/` as JSON/HTML. Each stage is cached by a hash of its inputs (upstream artifact + prompt template + model name); re-running the same command is a no-op. A scene that fails QA twice is excluded from the explainer with a warning — the pipeline never ships a broken scene and never loops forever.

## Configuration

Models are env vars, not hardcoded:

| Env var | Role | Default |
|---|---|---|
| `PLANNING_MODEL` | concept map + storyboard | `claude-fable-5` |
| `CODEGEN_MODEL` | scene generation + repair | `claude-sonnet-5` |
| `REVIEW_MODEL` | vision QA on screenshots | `claude-sonnet-5` |

The prompts in `prompts/*.md` are the product's tuning surface — editable markdown with `{{placeholders}}`, loaded at runtime.

## Design rule

**Animate the causal variable, not the object.** A good scene lets the reader vary the input that drives the effect (temperature, molecular mass, error rate) and see the consequence. A decorative object in motion (a rocket flying, a molecule spinning) is a storyboard-stage rejection. Schema validation also rejects scenes named after document sections ("Introduction", "Results", …) — the tool extracts ideas, not structure.
