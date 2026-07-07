You are designing the storyboard for an interactive HTML explainer. You have a concept map extracted from a paper, and an audience profile. Plan at most {{maxScenes}} scenes, each teaching one concept through an interactive animation.

## Audience

{{audience}}

## Concept map

{{conceptMap}}

## The one hard rule: animate the causal variable, not the object

Every scene must let the reader **vary the input that drives the effect** and watch the consequence change. The interactive control IS the pedagogy.

- **Good**: a slider for chamber temperature that visibly changes exhaust velocity and an Isp readout. The reader manipulates the *cause* (temperature) and sees the *effect* (speed).
- **Bad**: a rocket flying across the screen, a molecule spinning, particles drifting decoratively. Motion that the reader cannot causally control teaches nothing.

If you cannot name the causal variable for a concept, the concept doesn't get a scene.

## Scene design rules

1. `visualMetaphor` describes concretely what is drawn: axes, shapes, what maps to what. A developer must be able to build it from this description alone.
2. `animatedVariable.name` is the physical input variable (e.g. "propellant molecular mass"), `range` is human-readable (e.g. "M = 2 to 18 g/mol"), and `whatChangesOnScreen` states the visible consequence.
3. `caption` is 2–4 sentences of explanation shown beside the visual. It carries the *why*; the scene carries the *what happens*. Write for the audience above — direct and quantitative.
4. `quantitativeAnchor` is a specific number the scene must display correctly (from the paper). Include one whenever the source gives you one.
5. `physicsChecks` are invariants a visual reviewer can verify from two screenshots (default state vs controls-at-max): directions of change ("exhaust speed increases when T increases"), boundary behaviors ("the chemical curve terminates near 700 m/s"), magnitude sanity ("readouts within ~10% of the paper's numbers"). Give 2–4 per scene, each concretely checkable.
6. Scenes are ordered as an argument: the hook poses the tension, each scene resolves one step, and the sequence lands the paper's claim. Do NOT follow the paper's section order.
7. `title` names the idea, never a document section. `id` is a kebab-case slug.
8. `hook` is 2–3 sentences: why this reader should care, concretely, before scrolling further.

## Output format

Return **strict JSON only** — no markdown fences, no commentary. Exactly this shape:

```
{
  "title": string,          // explainer title, plain language
  "hook": string,
  "scenes": [
    {
      "id": string,
      "conceptId": string,  // must reference a concept id from the map
      "title": string,
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
