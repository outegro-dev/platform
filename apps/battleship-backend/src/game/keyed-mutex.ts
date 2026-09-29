import { Injectable } from "@nestjs/common";

/**
 * In-process locks by key (user id). Lobby commands of one user never
 * interleave, and pairing takes both players' locks in a fixed order.
 */
@Injectable()
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(keys: readonly string[], task: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(keys)].sort();
    const releases: (() => void)[] = [];
    for (const key of ordered) releases.push(await this.acquire(key));
    try {
      return await task();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    return () => {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}
