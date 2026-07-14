You are rewriting the flagged prose of a science explainer's script — its hook and scene captions — to fix specific review issues, for the reader below. Change ONLY the wording; do not change what each scene teaches or its numbers.

## The reader

{{audience}}

## Issues to fix

{{issues}}

## Current script (hook + per-scene captions)

{{script}}

## Rules for the rewrite

- **Abstract**: 2–4 short sentences, **one idea per sentence, ~15–20 words each (never past ~25)**, active voice, common words; the headline number in its own sentence. Never one long run-on. A non-expert must follow every sentence on one read.
- **Hook**: 3–4 sentences of clear, natural, sensible English; no jargon, no filler, no "slop." Every sentence must parse and mean something concrete. Same one-idea-per-sentence, short-sentence rule.
- **Captions**: 1–2 short sentences that point at the visual (the visual carries the teaching). Keep every number.
- **Metaphors**: only idiomatic, widely-recognized comparisons (compound interest, a traffic jam, a bucket brigade). Never invent a contrived image the reader must construct from scratch. If no familiar comparison fits, use none.
- Fix the flagged lines; you may lightly touch others for consistency, but keep unflagged text essentially as-is.

## Output format

Return **strict JSON only** — no fences, no commentary:

```
{
  "abstract": string,
  "hook": string,
  "captions": { "<scene-id>": string }
}
```

Include a key only for text you actually changed (`abstract`, `hook`, and/or specific `captions` entries). Omit anything you left alone.
