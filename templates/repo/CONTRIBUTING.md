# Contributing to this explanation

Everything readers see is generated from `storyboard.json`. Fork, edit, open a PR.

## Two kinds of change

**1. Prose changes — free and instant.**
Captions, titles, part names, part ledes, `teaches` lines, endorsement-adjacent text.
These render *outside* the scene graphics, so CI validates and rebuilds the full
explainer with no model calls. Your PR gets an `explainer-preview` artifact you can
download and open. Math in captions uses `\( ... \)` (tiny LaTeX subset).

**2. Scene-spec changes — need regeneration.**
`visualMetaphor`, `animatedVariable`, `physicsChecks`, `quantitativeAnchor` define the
generated graphics. If you change them, CI will fail with **"regeneration needed"** —
that's expected, not a mistake. A maintainer will check out your branch and run:

```bash
npx tsx src/repo-cli.ts regen <path-to-this-repo>   # from an explain-it checkout
```

which regenerates the stale scenes with *their own* model API key (this repo's CI has
no keys, on purpose), runs the vision QA, uploads a new sha256-pinned artifact bundle
release, and pushes the updated `scenes.lock.json` to your PR.

## Ground rules

- One logical improvement per PR. Explain *why* in the description.
- The storyboard is validated against the explain-it schema (ramp ordering, parts,
  no undefined terms are on you and the reviewing maintainer).
- `endorsements.json` changes are CODEOWNERS-gated to maintainers — endorsements are
  added only for verified, qualified people in the field, with their consent.
- Merges are done by maintainers. Stars are yours to give.
