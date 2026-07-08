You are designing the storyboard for an interactive HTML explainer. You have a concept map extracted from a paper, and an audience profile. Plan {{sceneBudget}}, each teaching one idea through an interactive animation.

## Audience

{{audience}}

## Concept map

{{conceptMap}}

## Hard rule 1: animate the causal variable, not the object

Every scene must let the reader **vary the input that drives the effect** and watch the consequence change. The interactive control IS the pedagogy.

- **Good**: a slider for chamber temperature that visibly changes exhaust velocity and an Isp readout. The reader manipulates the *cause* (temperature) and sees the *effect* (speed).
- **Bad**: a rocket flying across the screen, a molecule spinning, particles drifting decoratively. Motion that the reader cannot causally control teaches nothing.

If you cannot name the causal variable for a concept, the concept doesn't get a scene.

## Hard rule 2: atomicity — one new idea per scene

Each scene teaches exactly **ONE** new idea, and `teaches` states it in one sentence. If a scene needs two new ideas, split it into two scenes. At most one equation and at most 2 controls per scene. A scene whose `teaches` sentence contains an "and" joining two ideas is a failure.

## Hard rule 3: ramp — never assume what hasn't been taught

Scene 1 must be understandable from the audience's `assumeKnown` alone. Every later scene may only build on ideas taught by *earlier* scenes, declared in `requires` (ids of earlier scenes). Never assume the paper's subfield vocabulary — the audience profile's `doNotAssume` is binding.

**Feynman-first**: when the paper involves physics, OPEN with a refresher block of the first-principles concepts the domain science stands on — e.g. F = ma, conservation of momentum, kinetic theory of temperature — each as its own foundational scene with `requires: []`, even when the audience's `assumeKnown` technically covers them. Teach abstract framings before engineering units (e.g. "momentum bought per kilogram thrown overboard" before Isp = v_e/g₀ in seconds). Wire later scenes' `requires` back to these refreshers.

For a propulsion paper this means: F = ma, momentum recoil, what Isp actually measures, and the rocket equation each get their own foundational scene *before* any tradeoff or "why now" scene. Use foundational concepts from the map (marked `foundational: true`) to build this intro ramp.

## Scene design rules

1. `visualMetaphor` describes concretely what is drawn: axes, shapes, what maps to what. A developer must be able to build it from this description alone.
2. `animatedVariable.name` is the physical input variable (e.g. "propellant molecular mass"), `range` is human-readable (e.g. "M = 2 to 18 g/mol"), and `whatChangesOnScreen` states the visible consequence.
3. `caption` is 3–5 sentences shown beside the visual, written in the voice of a Feynman lecture: talk directly to the reader ("suppose you push on something…", "now watch what happens…"), pose the natural question and answer it, build one concrete physical picture, and let the wonder show without smirking. Plain words, active voice, no ornament — and keep every number. The caption carries the *why*; the scene carries the *what happens*. Wrap every symbol and formula in `\( ... \)` inline math using a tiny LaTeX subset (`_`, `^`, `{}`, `\sqrt{}`, `\frac{}{}`, `\text{}`; Unicode Greek and operator characters like Δ, η, ≈, ∝, · are used directly). Example: `\(Δv = I_{sp}·g_0·ln(m_{wet}/m_{dry})\)`, `\(v_e\)`, `\(N^2\)`. A bare `v_e` or `Isp` outside `\( \)` is a failure — the assembler typesets `\( \)` as MathML. Never use `$` as a math delimiter (captions contain real dollar amounts). Plain quantities with units ("500 kg", "3,000 K") stay outside math. Finally: no undefined terms — any operational word ("a dodge", "loiter", "conjunction") gets a plain-word definition at first use ("a collision dodge — swerving out of the way of a piece of debris"), and variable names are spelled out in words the first time they appear.
4. `quantitativeAnchor` is a specific number the scene must display correctly (from the paper). Include one whenever the source gives you one.
5. `physicsChecks` are invariants a visual reviewer can verify from two screenshots (default state vs controls-at-max): directions of change ("exhaust speed increases when T increases"), boundary behaviors ("the chemical curve terminates near 700 m/s"), magnitude sanity ("readouts within ~10% of the paper's numbers"). Give 2–4 per scene, each concretely checkable.
6. Scenes are ordered as an argument: the hook poses the tension, each scene resolves one step, and the sequence lands the paper's claim. Do NOT follow the paper's section order.
7. Group the scenes into 3–5 **parts** (top-level `parts` array; each scene names its `part`). The first part is the first-principles refresher (e.g. "Basic physics refresher"); later parts build the domain science and land the claim. Each part's `lede` is 1–2 sentences telling the reader what this part builds on and why it comes next — the connective tissue between sections must be explicit, never implied.
8. `title` states the scene's finding in plain words a first-time reader with no context understands instantly — a simple declarative assertion ("Thrust decides how long a maneuver takes"), never wordplay, metaphor, or a clever turn of phrase. Never a document-section name. `id` is a kebab-case slug.
9. `hook` is 3–4 sentences in the same Feynman voice: why this reader should care, concretely, before scrolling further — and if there is a refresher block, promise it ("to understand it honestly, we have to begin at the beginning").

## Output format

Return **strict JSON only** — no markdown fences, no commentary. Exactly this shape:

```
{
  "title": string,          // explainer title, plain language
  "hook": string,
  "parts": [
    { "title": string, "lede": string }   // 3–5 sections; lede = why this part comes next
  ],
  "scenes": [
    {
      "id": string,
      "conceptId": string,  // must reference a concept id from the map
      "part": string,       // must match a parts[].title; scenes grouped in part order
      "title": string,
      "teaches": string,    // the ONE new idea this scene teaches, one sentence
      "requires": string[], // ids of EARLIER scenes this builds on ([] for foundational scenes)
      "caption": string,
      "visualMetaphor": string,
      "animatedVariable": {
        "name": string,
        "control": "slider" | "buttons" | "toggle" | "play-pause",
        "range": string,
        "whatChangesOnScreen": string
      },
      "quantitativeAnchor": string?,
      "physicsChecks": string[]
    }
  ]
}
```
