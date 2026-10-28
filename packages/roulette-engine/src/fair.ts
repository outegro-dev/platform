/**
 * Provably fair rounds (ADR-012). fair-roll builds a chain from a secret
 * root backwards, `seed[i - 1] = SHA-256(seed[i])`, and publishes `seed[0]`
 * before the season. Round k reveals `seed[k]`; anyone checks that it hashes
 * to `seed[k - 1]` and recomputes the number. WebCrypto only, so the same
 * code runs in Node and in the browser (/fair).
 */

/** Seeds, commits and HMAC keys are 32 bytes, shown as 64 lowercase hex characters. */
export const SEED_BYTES = 32;
const HEX_SEED = /^[0-9a-f]{64}$/;

export function isSeedHex(value: string): boolean {
  return HEX_SEED.test(value);
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex))
    throw new TypeError("not a hex string");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

const subtle = () => globalThis.crypto.subtle;

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return new Uint8Array(await subtle().digest("SHA-256", bytes));
}

/** True when `revealed` is the link right after `previous`: SHA-256(revealed) = previous. */
export async function verifyLink(
  previousHex: string,
  revealedHex: string,
): Promise<boolean> {
  if (!isSeedHex(previousHex) || !isSeedHex(revealedHex)) return false;
  return bytesToHex(await sha256(hexToBytes(revealedHex))) === previousHex;
}

/**
 * Numbers at or above this bound are dropped: 2^32 values do not split into
 * 15 equal parts, and without the cut small numbers would come up a little
 * more often. 2^32 − 1 is a multiple of 15, so only 0xFFFFFFFF is dropped.
 */
const ZONE = 0xffff_ffff - (0xffff_ffff % 15);

/**
 * The number of round `round`: HMAC-SHA256 keyed with the round's seed over
 * "publicSeed:round:attempt", first 4 bytes big-endian, retried while they
 * fall outside the zone, then modulo 15. Matches the Rust prototype
 * (root 32 × 0x01, chain 1 000 000, round 1 → number 8).
 */
export async function roll(
  seedHex: string,
  publicSeed: string,
  round: number,
): Promise<number> {
  if (!isSeedHex(seedHex))
    throw new TypeError("seed must be 64 hex characters");
  const key = await subtle().importKey(
    "raw",
    hexToBytes(seedHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const encoder = new TextEncoder();
  for (let attempt = 0; ; attempt++) {
    const digest = new DataView(
      await subtle().sign(
        "HMAC",
        key,
        encoder.encode(`${publicSeed}:${round}:${attempt}`),
      ),
    );
    const x = digest.getUint32(0, false);
    if (x < ZONE) return x % 15;
  }
}

/**
 * Where the strip stops inside the winning tile, 0.1..0.9 of its width. It
 * comes from the round's seed, so every client stops at the same pixel and
 * nobody can steer it.
 */
export function stopOffset(seedHex: string): number {
  if (!isSeedHex(seedHex)) return 0.5;
  const tail = Number.parseInt(seedHex.slice(-4), 16);
  return 0.1 + (tail / 0xffff) * 0.8;
}
