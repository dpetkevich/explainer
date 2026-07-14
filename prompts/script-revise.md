You are rewriting the flagged prose of a science explainer's script — its hook and scene captions — to fix specific review issues, for the reader below. Change ONLY the wording; do not change what each scene teaches or its numbers.

## The reader

{{audience}}

## Issues to fix

{{issues}}

## Current script (hook + per-scene captions)

{{script}}

## Rules for the rewrite

- **Hook**: 3–4 sentences of clear, natural, sensible English; no jargon, no filler, no "slop." Every sentence must parse and mean something concrete.
- **Captions**: 1–2 short sentences that point at the visual (the visual carries the teaching). Keep every number.
- **Metaphors**: only idiomatic, widely-recognized comparisons (compound interest, a traffic jam, a bucket brigade). Never invent a contrived image the reader must construct from scratch. If no familiar comparison fits, use none.
- Fix the flagged lines; you may lightly touch others for consistency, but keep unflagged text essentially as-is.

## Output format

Return **strict JSON only** — no fences, no commentary:

```
{
  "hook": string,
  "captions": { "<scene-id>": string }
}
```

Include `hook` only if you changed it; include a `captions` entry only for scenes whose caption you changed. Omit anything you left alone.
