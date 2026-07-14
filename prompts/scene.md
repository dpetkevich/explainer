Build one interactive scene for a scientific explainer as a **complete, standalone HTML file**. Return ONLY the HTML document — no commentary, no markdown fences.

## The scene to build

{{scene}}

## Audience (calibrate labels and readouts to this reader)

{{audience}}

## Scene HTML contract — every point is mandatory

1. **Complete document**: `<!doctype html>`, inline `<style>` and `<script>`. **No external requests of any kind** — no CDNs, no fonts, no images, no fetch. The file must work offline from `file://`.
2. **Layout**: renders correctly at 680 px wide; degrades gracefully at 380 px (flex-wrap, no horizontal scroll, `max-width: 100%` on canvas/SVG). **No clipped text anywhere**: every axis label, tick value, and annotation — especially on right-hand axes and top edges — must sit fully inside the drawable area with margin to spare, at both widths. A label that touches or crosses the panel edge is a failure.
3. **Vanilla JS only.** Canvas or SVG for the animation; `requestAnimationFrame` for motion. Respect `prefers-reduced-motion`: when set, start paused with a visible play button instead of auto-animating.
4. **Controls**: native `<input type="range">`, `<button>`, `<select>` only. Label every control with the physical variable and its units. Every displayed number goes through `toFixed(...)` or `Math.round(...)` — never raw floats like `3.0000000004`.
5. **Real physics**: compute everything from the actual formulas in JS with named constants visible in the code (e.g. `const R = 8.314; // J/(mol·K)`), so the scene is auditable. No lookup tables of pre-baked outputs. The physics checks in the scene spec above must hold — they will be verified from screenshots.
6. **The animated variable** from the spec must be the primary control, spanning the specified range, and moving it must produce the specified on-screen change in the physically correct direction.
7. **Colors**: define as CSS custom properties in `:root`, with a `@media (prefers-color-scheme: dark)` override block. Read them in JS via `getComputedStyle` if the canvas needs them. No pure `#000`/`#fff` hardcodes in the animation layer. Maintain adequate text contrast in both modes.
8. **Text discipline**: text inside the scene is limited to axis labels, control labels, on-diagram part names, brief annotations, and value readouts — no explanatory paragraphs (the caption lives OUTSIDE the scene and is now only 1–2 sentences). But because the caption is minimal, the drawing must carry the meaning on its own: name every part of a diagram, label every axis and curve, and annotate the one or two values that matter directly on the chart. A reader glancing at the scene with the caption hidden should still grasp the relationship or structure.
9. **Equations — LaTeX-style typesetting via native MathML**: render every displayed formula as `<math>` markup, which browsers typeset like LaTeX with no libraries and no network. Use `display="block"` for a standalone equation line; `<mi>` for variables (italic by default), `<mn>` for numbers, `<mo>` for operators, `<msub>`/`<msup>` for sub/superscripts, `<mfrac>` for fractions, `<msqrt>` for radicals, and `<mtext>` for word subscripts. Example: `<math display="block"><msub><mi>v</mi><mtext>recoil</mtext></msub><mo>=</mo><mfrac><mrow><msub><mi>m</mi><mtext>wrench</mtext></msub><mo>·</mo><mi>v</mi></mrow><msub><mi>M</mi><mtext>astronaut</mtext></msub></mfrac></math>`. Never fake math with plain text, `<sub>` tags, or ASCII (`v_e = sqrt(...)`). MathML inherits `color`/`font-size` from CSS, so it follows the light/dark custom properties automatically. No MathJax/KaTeX.
10. **Every symbol must be explained.** A reader must never see a symbol whose meaning is not stated in the scene. Directly beneath each displayed equation, add one compact legend line in smaller muted text defining every symbol with its unit, e.g. "p — momentum (kg·m/s) · m, M — masses of wrench and astronaut (kg) · v — throw speed (m/s)". Symbols that already appear as labeled readouts or control labels still get a legend entry — the equation must be readable on its own. The same rule applies to the plot itself: every curve, marker, and reference line gets an on-plot label in plain words (e.g. "typical ion engine (~0.05 N)", "Δv = 100 m/s"), using only terms the scene spec itself uses — never unexplained jargon. Abbreviations count: an element labeled "C1" or "τ_s" with no on-scene definition is a failure — write "check 1" or add a legend line. Control captions must plainly say what the control does to a reader who has seen nothing else ("Flip qubit 3 — simulate an error", not "Strike qubit 3").
11. **Readiness signal**: once the scene is initialized and the first frame is drawn, set `window.__sceneReady = true`.
12. **Height reporting**: include exactly this snippet (adjusted only for element selection) so the parent page can size the embedding iframe:

```js
const __ro = new ResizeObserver(() => {
  parent.postMessage({ explainItScene: "{{sceneId}}", height: document.documentElement.scrollHeight }, "*");
});
__ro.observe(document.documentElement);
```

13. **No console errors or warnings.** The scene is loaded headlessly and any console error is an automatic failure.
14. **Visual restraint**: this scene teaches ONE idea — draw exactly one plot OR one diagram, never both. At most 2 controls and at most 4 value readouts. Target ≤ 250 lines / ~10 KB total. If you are tempted to add a second visualization, the storyboard already split that idea into its own scene.

Quality bar: the reader should be able to move the control, immediately see the consequence, and read off a correct number. Smooth, legible, quantitatively honest.
