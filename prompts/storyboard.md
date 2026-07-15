You are designing the storyboard for an interactive HTML explainer. You have a concept map extracted from a paper, and an audience profile. Plan {{sceneBudget}}, each teaching one idea through an interactive animation.

## Audience

{{audience}}

## Concept map

{{conceptMap}}

## Guiding principle: let the visuals carry the explanation

A finished explainer should very nearly stand on its **diagrams, charts, and equations alone**. Words are the connective tissue between visuals, and they are the hardest part for a reader to absorb — so use as few as possible. Every scene's meaning must live in something the reader can *see and manipulate*; the caption only points at it. Whenever a sentence could be drawn instead, draw it.

## Hard rule 1: animate the causal variable, not the object

Every scene must let the reader **vary the input that drives the effect** and watch the consequence change. The interactive control IS the pedagogy.

- **Good**: a slider for chamber temperature that visibly changes exhaust velocity and an Isp readout. The reader manipulates the *cause* (temperature) and sees the *effect* (speed).
- **Bad**: a rocket flying across the screen, a molecule spinning, particles drifting decoratively. Motion that the reader cannot causally control teaches nothing.

When a scene teaches a **relationship between quantities**, draw it as a chart/graph whose independent variable(s) sit on controls the reader moves, so the dependent quantity visibly responds — the relationship is read off the moving chart, not described in prose. When a concept has **parts, structure, or flow**, draw it as a labeled diagram that names the parts and shows how they connect. If you cannot name the causal variable for a concept, the concept doesn't get a scene.

## Hard rule 2: atomicity — one new idea per scene

Each scene teaches exactly **ONE** new idea, and `teaches` states it in one sentence. If a scene needs two new ideas, split it into two scenes. At most one equation and at most 2 controls per scene. A scene whose `teaches` sentence contains an "and" joining two ideas is a failure. A scene that must explain a mechanism AND report its full-scale payoff numbers is two scenes: teach the mechanism on a toy example first (a dozen elements the reader can count), then pay it out with the paper's real numbers in the next scene. Likewise, a process with several sequential steps gets one scene per step, each with its own graphic — never one caption narrating steps the reader cannot see. And every scene opens by naming the need it answers before presenting its answer ("Remember what a parity check does: it compares qubits. Here is the problem —"): a capability whose motivation arrives later, or never, teaches nothing at the moment it is read.

## Hard rule 3: ramp — never assume what hasn't been taught

Scene 1 must be understandable from the audience's `assumeKnown` alone. Every later scene may only build on ideas taught by *earlier* scenes, declared in `requires` (ids of earlier scenes). Never assume the paper's subfield vocabulary — the audience profile's `doNotAssume` is binding.

**Prerequisite-gap ramp (do this first).** Compare the paper's `prerequisites` and `foundational: true` concepts against the audience's `assumeKnown`. **Every prerequisite the paper needs that the reader is not told they already know gets its own dedicated refresher scene, before any scene that uses it** — do not assume it just because it seems basic to an expert. The reader may hold a strong background in a *different* field (e.g. a physicist reading a reinforcement-learning + GPU paper), so bedrock nouns of the paper's field are undefined terms to them: define what an *agent*, a *simulator* (the state→action→next-state loop), a *GPU / thread / warp* is, each in its own building-blocks scene, before the mechanism scenes. Err toward more foundational scenes, not fewer; when unsure whether the reader knows a prerequisite, assume they do not and add the refresher.

**Feynman-first**: when the paper involves physics, OPEN with a refresher block of the first-principles concepts the domain science stands on — e.g. F = ma, conservation of momentum, kinetic theory of temperature — each as its own foundational scene with `requires: []`, even when the audience's `assumeKnown` technically covers them. Teach abstract framings before engineering units (e.g. "momentum bought per kilogram thrown overboard" before Isp = v_e/g₀ in seconds). Wire later scenes' `requires` back to these refreshers.

For a propulsion paper this means: F = ma, momentum recoil, what Isp actually measures, and the rocket equation each get their own foundational scene *before* any tradeoff or "why now" scene. Use foundational concepts from the map (marked `foundational: true`) to build this intro ramp.

## Scene design rules

1. `visualMetaphor` describes concretely what is drawn: axes, shapes, labels, what maps to what. A developer must be able to build it from this description alone. Default to one of two forms: a **labeled diagram** (parts named, connections/flow drawn) for structural concepts, or an **interactive chart** (the relationship plotted, independent variable on a control) for quantitative relationships. Push the explanation into the drawing — labels, annotations, and axes — so the scene reads with almost no caption.
2. `animatedVariable.name` is the physical input variable (e.g. "propellant molecular mass"), `range` is human-readable (e.g. "M = 2 to 18 g/mol"), and `whatChangesOnScreen` states the visible consequence.
3. `caption` is **1–2 short sentences** beside the visual — the fewest words that name the need the scene answers and point the reader at what the visual shows ("Communication cost climbs with the reduction size; drag it and watch when it overtakes compute."). The *visual* carries the teaching; the caption only connects and motivates. Keep the Feynman warmth but stay terse (Zinsser: omit needless words, short words, lead with the point); plain idiomatic English — if a phrase sounds odd read aloud ("the escape is beautiful"), rewrite it ("the solution is beautiful"). Cash any mechanism out in the *visual* (a concrete miniature the reader can manipulate), not in caption prose. Keep every number. Wrap every symbol and formula in `\( ... \)` inline math using a tiny LaTeX subset (`_`, `^`, `{}`, `\sqrt{}`, `\frac{}{}`, `\text{}`; Unicode Greek and operator characters like Δ, η, ≈, ∝, · are used directly). Example: `\(Δv = I_{sp}·g_0·ln(m_{wet}/m_{dry})\)`, `\(v_e\)`, `\(N^2\)`. A bare `v_e` or `Isp` outside `\( \)` is a failure — the assembler typesets `\( \)` as MathML. Never use `$` as a math delimiter (captions contain real dollar amounts). Plain quantities with units ("500 kg", "3,000 K") stay outside math. No undefined terms — any operational word ("a dodge", "loiter", "conjunction") gets a plain-word definition at first use ("a collision dodge — swerving out of the way of a piece of debris"), and variable names are spelled out in words the first time they appear. **A metaphor is a doorway, not a residence**: you may open a concept with a one-line plain-language metaphor, but immediately name the field's proper term and from then on use the proper term and drop the metaphor — never sustain a metaphor across a scene or carry it forward as scaffolding. The reader should finish the explainer owning the field's real vocabulary. **Any metaphor must be idiomatic**: a real, widely-recognized comparison the reader already holds in their head (compound interest, a traffic jam, a bucket brigade, a phone tree) — never an invented or contrived scene they have to construct from scratch ("building a fort out of movable boxes" is a failure: it is not a thing anyone recognizes). If you cannot find a genuinely familiar comparison, use none. **A metaphor must survive the reader's arithmetic**: if it invites a calculation that doesn't work (two yes/no answers encoding a continuous angle), it is worse than no metaphor — don't use it. When a mechanism's WHY is truly beyond the audience (it needs the mathematics), say so honestly and teach the verified CONTRACT instead — inputs, outputs, invariants — with an interactive that lets the reader test the contract, including a 'try to cheat' control that visibly fails ('send the bits without the key: junk arrives'). And when even the contract is too much, declare an explicit black box: "a standard, well-tested procedure called X, whose inner workings we won't explain here," stating only its cost and its guarantees.
4. `quantitativeAnchor` is a specific number the scene must display correctly (from the paper). Include one whenever the source gives you one.
5. `physicsChecks` are invariants a visual reviewer can verify from two screenshots (default state vs controls-at-max): directions of change ("exhaust speed increases when T increases"), boundary behaviors ("the chemical curve terminates near 700 m/s"), magnitude sanity ("readouts within ~10% of the paper's numbers"). Give 2–4 per scene, each concretely checkable.

5a. **Show the cause, not just the effect.** When a scene demonstrates an effect (warp divergence wasting lanes, a slowdown, a curve bending), the visual must make its concrete *cause* visible or named on-scene — the reader should never have to ask "why does this happen?" (e.g. show that divergence happens *because* different worlds take data-dependent branches, not just that lanes go idle).

5b. **State the one takeaway.** Every scene has a single takeaway a first-time reader can state after looking: the `title` asserts it and the `visualMetaphor`/`animatedVariable` confirm it. If a reader could look at the finished scene and ask "what am I supposed to take from this?", the scene has failed — redesign it so the point is unmistakable.
6. Scenes are ordered as an argument: the hook poses the tension, each scene resolves one step, and the sequence lands the paper's claim. Do NOT follow the paper's section order.
7. Group the scenes into exactly this four-section arc, in this order (top-level `parts` array; each scene names its `part`):
   1. **The basic building blocks** — the first-principles refresher (Feynman-first, Hard rule 3) plus the domain's ground rules, ending on the limitation of existing technology that the paper attacks.
   2. **The new technology** — how the paper's machine or idea actually works.
   3. **Why it's a breakthrough vs existing tech** — head-to-head against the status quo, with the paper's numbers: cost, performance, readiness.
   4. **Why now** — what changed to make it possible or urgent, and what it leads to next.

   Part titles may be phrased for the specific paper ("Why it beats existing rockets"), but the four-section arc is fixed — every paper builds up the same way. Each part's `lede` is 1–2 sentences telling the reader what this part builds on and why it comes next; the connective tissue between sections must be explicit, never implied.
8. `title` states the scene's finding in plain words a first-time reader with no context understands instantly — a simple declarative assertion ("Thrust decides how long a maneuver takes"), never wordplay, metaphor, or a clever turn of phrase. Never a document-section name. `id` is a kebab-case slug.
9. `hook` is 3–4 sentences in the same Feynman voice: why this reader should care, concretely, before scrolling further — and if there is a refresher block, promise it ("to understand it honestly, we have to begin at the beginning"). The hook is read before ANY scene, so it may contain no terms of art at all: describe the mechanism in plain words ("a way to spread one fragile bit's information across many atoms, so single failures can be caught") rather than naming it ("error-correcting codes"). The same rule binds part titles and ledes — nothing anywhere in the script uses a term before the scene that teaches it. **The hook must read as clear, natural, sensible English — never filler or "slop."** Every sentence must parse and mean something concrete on first read; if you use a metaphor it must be idiomatic (see rule 3's idiomatic-metaphor test) — a contrived image the reader cannot instantly picture ("building a fort out of movable boxes") is a failure. Read the hook aloud: if any phrase sounds like word-salad or a stretched analogy, rewrite it plainly.

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
