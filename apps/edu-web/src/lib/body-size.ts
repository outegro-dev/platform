/*
 * edu-backend takes JSON bodies of up to 100 kB. The reader's requests
 * that grow with what the reader does — an SQL task's result in an
 * attempt, the assistant's bodies — are measured before they leave: one
 * over the limit gets a clear "too large" here and is never sent, so it can
 * neither fail there nor offer a retry that could never succeed.
 */

/** The largest JSON body sent to edu-backend: its 100 kB, with room to spare. */
export const MAX_BODY_BYTES = 96 * 1024;

/** The size of a text in UTF-8 bytes (as it goes over the wire). */
export function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** The size of a value as a JSON body, in UTF-8 bytes. */
export function jsonBytes(value: unknown): number {
  return textBytes(JSON.stringify(value) ?? "");
}

/** Whether a value fits in one JSON body for edu-backend. */
export function fitsBody(value: unknown): boolean {
  return jsonBytes(value) <= MAX_BODY_BYTES;
}
