You are analyzing the scientific paper or technical article provided above. Your job is to extract the *ideas* that a reader must understand to genuinely get the paper's claim — not to summarize the document.

## Audience

Calibrate everything to this specific reader. Skip what they already know; do not assume what they don't.

{{audience}}

## Your task

For each core concept, ask yourself: **if the author were at a whiteboard with a smart colleague from an adjacent field, what would they draw and animate to make that colleague say "oh, I get it"?** Extract those animatable ideas.

Rules:

1. Extract **ideas, never document structure**. Concepts named "Introduction", "Methods", "Results", "Executive Summary", or anything resembling a section heading are a hard failure. A concept is a causal mechanism, a trade-off, a surprising quantitative relationship, or an enabling breakthrough — something with a *because* in it.
2. Rank concepts by importance to the paper's central claim. Return {{conceptBudget}}.
3. Extract the **prerequisite ladder** too: foundational concepts the paper's ideas stand on are legitimate concepts even when the paper doesn't restate them (e.g. what thrust is, what a figure of merit actually measures). Mark these with `foundational: true`. For physics papers, run the ladder all the way down to first principles (F = ma, conservation laws, kinetic theory of temperature): include those rungs as `foundational: true` concepts even when the audience's `assumeKnown` technically covers them — the explainer opens with a Feynman-lectures refresher block built from them. The explainer must be able to ramp this audience from `assumeKnown` up to the paper's claim with no gaps — include every rung that ramp needs.
4. `coreMechanism` must tell the causal story in 2–4 sentences: what drives what, and why.
5. `whyItMatters` must connect the concept to the paper's main claim in 1–2 sentences.
6. Include `keyEquation` (LaTeX) only if the equation is load-bearing for understanding — not decorative.
7. Include `misconception` when there is a likely wrong intuition worth preempting for this audience.
8. Keep the numbers. If the source gives specific quantities (temperatures, speeds, costs, timescales), preserve them in the mechanism text — they are what make an explanation concrete.
9. Ignore anything about funding, team, business strategy, or deal terms. Extract the science and engineering only.

## Output format

Return **strict JSON only** — no markdown fences, no commentary before or after. The JSON must match exactly this shape:

```
{
  "paper": { "title": string, "authors": string[], "oneSentenceClaim": string, "category": "Computing" | "Space" | "Quantum" },
  "prerequisites": string[],
  "concepts": [
    {
      "id": string,              // kebab-case slug
      "name": string,
      "whyItMatters": string,
      "coreMechanism": string,
      "keyEquation": string?,    // LaTeX, only if load-bearing
      "keyFigureRef": string?,   // e.g. "Fig. 3" if a paper figure is central
      "misconception": string?,
      "foundational": boolean?   // true for prerequisite-ladder concepts the paper assumes
    }
  ]
}
```

`prerequisites` lists what the paper assumes the reader knows (so downstream stages know what NOT to explain).

`category` is the single best-fit subject tag, chosen from exactly this list: **Computing** (AI/ML, systems, GPUs, graphics, algorithms, software), **Space** (propulsion, aerospace, astronomy, orbital physics), **Quantum** (qubits, quantum algorithms or hardware). Pick the closest one.

`oneSentenceClaim` is the paper's **abstract in plain language** — a brief listing gist of **2–3 short sentences** (what the work does, why it matters, and the one headline number). Keep it tight; it appears on a small card, so never more than 3 sentences. Write it clear and simple:
- **One idea per sentence**, each sentence **about 15–20 words** and never past ~25. Never a single run-on; do not stack clauses with dashes, semicolons, or "while…".
- **Active voice, present tense, common words.** Lead with what the work is and does, then why it matters, then the single headline number **in its own sentence**.
- **No undefined jargon** — a curious non-expert must follow every sentence on one read; gloss any unavoidable term in plain words.
Prefer the plainest phrasing that is still accurate. (Bad: one 60-word sentence with five clauses. Good: "Training an AI agent can take billions of practice runs. A slow simulator, not the algorithm, is usually the bottleneck. This work runs thousands of simulated worlds at once on a single GPU. That makes training about 100× faster.")
