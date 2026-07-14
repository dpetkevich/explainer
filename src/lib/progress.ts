/**
 * Structured progress events emitted by the generation pipeline.
 *
 * The stages log to the console via log.ts as before; when a Ctx carries an
 * `onEvent` callback (set by the web server's job worker), the same milestones
 * are also emitted as typed events so a browser can watch a run live. The
 * callback is optional and best-effort — the CLI simply leaves it unset.
 */
export type Stage = "ingest" | "storyboard" | "scenes" | "assemble";

export type ProgressEvent =
  | { type: "stage-start"; stage: Stage }
  | { type: "ingest-done"; concepts: number }
  | { type: "storyboard-ready"; title: string; sceneCount: number }
  | { type: "scene-start"; id: string }
  | { type: "scene-pass"; id: string; attempts: number }
  | { type: "scene-fail"; id: string; kinds: string[] }
  | { type: "assembled"; scenesIncluded: number }
  | { type: "error"; stage: Stage; message: string };

export type ProgressSink = (event: ProgressEvent) => void;

/** Best-effort emit: a throwing sink must never break a generation run. */
export function emit(sink: ProgressSink | undefined, event: ProgressEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {
    // A misbehaving subscriber (e.g. a closed SSE connection) is not fatal.
  }
}
