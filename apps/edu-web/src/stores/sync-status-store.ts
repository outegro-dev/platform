import { makeAutoObservable, runInAction } from "mobx";
import type { WriteFailure } from "@/lib/reader-api";

/** Where a write to the reader's account stands. */
export type SyncStatus =
  | "saving"
  | "saved"
  /** Not sent: the browser is offline. A retry sends it. */
  | "offline"
  | WriteFailure;

/** What a write reports back when it finishes. */
export type SyncResult = "saved" | WriteFailure;

/** A write; run again as it is by a retry (same body, same key). */
export type SyncOperation = () => Promise<SyncResult>;

const retryable = (status: SyncStatus | null) =>
  status === "failed" || status === "offline";

type Deps = { isOnline: () => boolean };

/**
 * The status of every write of a reading page, by key (an exercise, a
 * card): saving, saved, or why not. A write that may succeed later (no
 * connection, a failed request) is kept, so a retry sends exactly the same
 * request again; one that never can (no access, an out-of-date page) is
 * dropped. A newer write under the same key replaces the older one, and a
 * late answer to the older one changes nothing.
 */
export class SyncStatusStore {
  private readonly statuses = new Map<string, SyncStatus>();
  private readonly operations = new Map<string, SyncOperation>();
  private readonly runs = new Map<string, number>();
  private sequence = 0;
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
    makeAutoObservable<this, "operations" | "runs" | "sequence" | "deps">(
      this,
      { operations: false, runs: false, sequence: false, deps: false },
      { autoBind: true },
    );
  }

  statusOf(key: string): SyncStatus | null {
    return this.statuses.get(key) ?? null;
  }

  /** The last write under `key` failed in a way a retry can fix. */
  canRetry(key: string): boolean {
    return retryable(this.statusOf(key)) && this.operations.has(key);
  }

  /** Of `keys`, those with each status (for a summary of many writes). */
  tally(keys: Iterable<string>): Partial<Record<SyncStatus, number>> {
    const counts: Partial<Record<SyncStatus, number>> = {};
    for (const key of keys) {
      const status = this.statuses.get(key);
      if (status) counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }

  /** Starts a write under `key`; resolves with where it ended. */
  run(key: string, operation: SyncOperation): Promise<SyncStatus> {
    this.operations.set(key, operation);
    return this.send(key, operation);
  }

  /** Sends the kept write again, if a retry can help. */
  retry(key: string): Promise<SyncStatus> | null {
    const operation = this.operations.get(key);
    if (!operation || !retryable(this.statusOf(key))) return null;
    return this.send(key, operation);
  }

  /** Retries every one of `keys` that can be retried. */
  retryAll(keys: Iterable<string>): void {
    for (const key of [...keys]) void this.retry(key);
  }

  private async send(key: string, operation: SyncOperation) {
    const run = ++this.sequence;
    this.runs.set(key, run);
    if (!this.deps.isOnline()) {
      this.statuses.set(key, "offline");
      return "offline";
    }
    this.statuses.set(key, "saving");
    let status: SyncStatus;
    try {
      status = await operation();
    } catch {
      // A server action that never answered: the network, not the server.
      status = "failed";
    }
    if (status === "failed" && !this.deps.isOnline()) status = "offline";
    const final = status;
    runInAction(() => {
      if (this.runs.get(key) !== run) return;
      this.statuses.set(key, final);
      if (!retryable(final)) this.operations.delete(key);
    });
    return final;
  }
}
