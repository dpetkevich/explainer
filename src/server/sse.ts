/**
 * In-memory pub/sub for live generation progress. The job worker publishes
 * ProgressEvents (plus a terminal "closed" marker) keyed by explainer id; each
 * open SSE connection subscribes and streams them to the browser. Purely
 * in-process — a server restart drops subscribers, and clients reconnect and
 * re-snapshot from the DB.
 */
import type { ProgressEvent } from "../lib/progress.js";

export type StreamMessage = ProgressEvent | { type: "closed"; status: "done" | "failed"; error?: string };

type Subscriber = (msg: StreamMessage) => void;

const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(id: string, fn: Subscriber): () => void {
  let set = subscribers.get(id);
  if (!set) {
    set = new Set();
    subscribers.set(id, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribers.delete(id);
  };
}

export function publish(id: string, msg: StreamMessage): void {
  const set = subscribers.get(id);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(msg);
    } catch {
      // a dead connection is cleaned up on its own close handler
    }
  }
}
