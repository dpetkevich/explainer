export function info(stage: string, msg: string): void {
  console.log(`[${stage}] ${msg}`);
}

export function warn(stage: string, msg: string): void {
  console.warn(`[${stage}] ⚠ ${msg}`);
}

/**
 * Pipeline error carrying the stage, optional scene id, and the artifact path
 * the user should inspect. The CLI prints these fields as the primary output;
 * the stack trace only appears with DEBUG=1.
 */
export class StageError extends Error {
  constructor(
    public stage: string,
    message: string,
    public artifactPath?: string,
    public sceneId?: string
  ) {
    super(message);
    this.name = "StageError";
  }
}

export function reportError(err: unknown): void {
  if (err instanceof StageError) {
    const where = err.sceneId ? `${err.stage} / scene "${err.sceneId}"` : err.stage;
    console.error(`\n✗ [${where}] ${err.message}`);
    if (err.artifactPath) console.error(`  artifact: ${err.artifactPath}`);
  } else if (err instanceof Error) {
    console.error(`\n✗ ${err.message}`);
  } else {
    console.error(`\n✗ ${String(err)}`);
  }
  if (process.env.DEBUG && err instanceof Error) console.error(err.stack);
}
