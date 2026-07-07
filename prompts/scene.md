Build one interactive scene for a scientific explainer as a **complete, standalone HTML file**. Return ONLY the HTML document — no commentary, no markdown fences.

## The scene to build

{{scene}}

## Audience (calibrate labels and readouts to this reader)

{{audience}}

## Scene HTML contract — every point is mandatory

1. **Complete document**: `<!doctype html>`, inline `<style>` and `<script>`. **No external requests of any kind** — no CDNs, no fonts, no images, no fetch. The file must work offline from `file://`.
2. **Layout**: renders correctly at 680 px wide; degrades gracefully at 380 px (flex-wrap, no horizontal scroll, `max-width: 100%` on canvas/SVG).
3. **Vanilla JS only.** Canvas or SVG for the animation; `requestAnimationFrame` for motion. Respect `prefers-reduced-motion`: when set, start paused with a visible play button instead of auto-animating.
4. **Controls**: native `<input type="range">`, `<button>`, `<select>` only. Label every control with the physical variable and its units. Every displayed number goes through `toFixed(...)` or `Math.round(...)` — never raw floats like `3.0000000004`.
5. **Real physics**: compute everything from the actual formulas in JS with named constants visible in the code (e.g. `const R = 8.314; // J/(mol·K)`), so the scene is auditable. No lookup tables of pre-baked outputs. The physics checks in the scene spec above must hold — they will be verified from screenshots.
6. **The animated variable** from the spec must be the primary control, spanning the specified range, and moving it must produce the specified on-screen change in the physically correct direction.
7. **Colors**: define as CSS custom properties in `:root`, with a `@media (prefers-color-scheme: dark)` override block. Read them in JS via `getComputedStyle` if the canvas needs them. No pure `#000`/`#fff` hardcodes in the animation layer. Maintain adequate text contrast in both modes.
8. **Text discipline**: text inside the scene is limited to axis labels, control labels, and value readouts. The explanatory caption lives OUTSIDE the scene — do not duplicate explanation paragraphs inside the HTML.
9. **Equations**: if the spec includes a key equation, render it as plain styled HTML/Unicode (e.g. `v_e = √(2γ/(γ−1)·RT/M)`) — no MathJax/KaTeX.
10. **Readiness signal**: once the scene is initialized and the first frame is drawn, set `window.__sceneReady = true`.
11. **Height reporting**: include exactly this snippet (adjusted only for element selection) so the parent page can size the embedding iframe:

```js
const __ro = new ResizeObserver(() => {
  parent.postMessage({ explainItScene: "{{sceneId}}", height: document.documentElement.scrollHeight }, "*");
});
__ro.observe(document.documentElement);
```

12. **No console errors or warnings.** The scene is loaded headlessly and any console error is an automatic failure.

Quality bar: the reader should be able to move the control, immediately see the consequence, and read off a correct number. Smooth, legible, quantitatively honest.
