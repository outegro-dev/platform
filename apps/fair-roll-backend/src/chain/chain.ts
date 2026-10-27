import { createHash } from "node:crypto";

/** One stored link in every this many: a lookup hashes at most this many times. */
const CHECKPOINT_EVERY = 1024;

const sha256 = (link: Buffer) => createHash("sha256").update(link).digest();

/**
 * The seed chain of a season, built from the secret root backwards:
 * `seed[length] = root`, `seed[i - 1] = SHA-256(seed[i])`. Only checkpoints
 * stay in memory (32 KB for a million rounds instead of 32 MB); `seedAt`
 * hashes forward from the nearest one above. Building takes about a second
 * per million links, once at startup.
 */
export class SeedChain {
  private readonly checkpoints = new Map<number, Buffer>();
  readonly commit: string;

  constructor(
    root: Buffer,
    readonly length: number,
  ) {
    if (root.length !== 32) throw new RangeError("root must be 32 bytes");
    let link = root;
    this.checkpoints.set(length, link);
    for (let i = length - 1; i >= 0; i--) {
      link = sha256(link);
      if (i % CHECKPOINT_EVERY === 0) this.checkpoints.set(i, link);
    }
    this.commit = link.toString("hex");
  }

  /** seed[k] as hex, for 0 ≤ k ≤ length. */
  seedAt(k: number): string {
    if (!Number.isSafeInteger(k) || k < 0 || k > this.length)
      throw new RangeError(`no link ${k} in a chain of ${this.length}`);
    const above = Math.min(
      this.length,
      Math.ceil(k / CHECKPOINT_EVERY) * CHECKPOINT_EVERY,
    );
    let link = this.checkpoints.get(above) as Buffer;
    for (let i = above; i > k; i--) link = sha256(link);
    return link.toString("hex");
  }
}
