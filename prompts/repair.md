An interactive explainer scene failed QA. Fix it and return the **complete corrected HTML document** — the entire file, not a diff, no commentary, no markdown fences.

## What failed

{{problems}}

## The current (broken) HTML

```html
{{currentHtml}}
```

## The contract the corrected file must still satisfy

{{sceneContract}}

Fix every listed failure while preserving everything that already works. Return the full corrected HTML document and nothing else.
