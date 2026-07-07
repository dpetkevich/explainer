# explain-it

Turn a scientific paper (PDF) or technical article (URL) into a single self-contained, scrollable HTML explainer in which each core concept is taught through an interactive HTML/SVG/canvas animation — sliders, toggles, live physics — not video.

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
  --max-scenes <n>     cap on scenes (default: 5)
  --stage <name>       run up to: ingest | storyboard | scenes | qa | assemble
  --scene <id>         regenerate a single scene by id, then re-run qa + assemble
  --force              ignore cache for the requested stage(s)
  --open               open the finished explainer in the default browser
```

The final deliverable is `<out>/explainer.html` — one file, zero network dependencies, works from `file://`, light and dark mode.

## Pipeline

```
input → [ingest] concept-map.json → [storyboard] storyboard.json
      → [scenes] work/scenes/<id>.html   (one model call per scene)
      → [qa]     screenshots → vision review → repair loop (max 2 repairs)
      → [assemble] explainer.html        (deterministic templating, no model)
```

Every intermediate artifact lives in `<out>/work/` as JSON/HTML. Each stage is cached by a hash of its inputs (upstream artifact + prompt template + model name); re-running the same command is a no-op. A scene that fails QA twice is excluded from the explainer with a warning — the pipeline never ships a broken scene and never loops forever.

## Configuration

Models are env vars, not hardcoded:

| Env var | Role | Default |
|---|---|---|
| `PLANNING_MODEL` | concept map + storyboard | `claude-fable-5` |
| `CODEGEN_MODEL` | scene generation + repair | `claude-fable-5` |
| `REVIEW_MODEL` | vision QA on screenshots | `claude-fable-5` |

The prompts in `prompts/*.md` are the product's tuning surface — editable markdown with `{{placeholders}}`, loaded at runtime.

## Design rule

**Animate the causal variable, not the object.** A good scene lets the reader vary the input that drives the effect (temperature, molecular mass, error rate) and see the consequence. A decorative object in motion (a rocket flying, a molecule spinning) is a storyboard-stage rejection. Schema validation also rejects scenes named after document sections ("Introduction", "Results", …) — the tool extracts ideas, not structure.
