import { Logger } from "@nestjs/common";
import { z } from "zod";

const flag = z.stringbool().default(false);

/**
 * SAFE_MODE=true (OPS-07): a service started on a database restored from a
 * backup does nothing outside its own HTTP API until an operator has looked
 * at the restored state and reconciled it with the providers. Off: the
 * outbox relay (no events published), queue consumers (no events applied),
 * outgoing messages, provider calls and timers that act on data. Then the
 * service is restarted without the flag and everything that waited runs.
 */
export function safeMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return flag.parse(env.SAFE_MODE?.trim() || undefined);
}

const logger = new Logger("SafeMode");
const told = new Set<string>();

/** True in safe mode, after logging once per worker that it stays off. */
export function heldBySafeMode(worker: string): boolean {
  if (!safeMode()) return false;
  if (!told.has(worker)) {
    told.add(worker);
    logger.warn({ worker }, "SAFE_MODE: worker stays off");
  }
  return true;
}
