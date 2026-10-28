/**
 * A caller's meta or an issue's details as "key: value · key: value": easier
 * to read than JSON, and it wraps at its spaces in a narrow cell.
 */
export function pairs(record: Record<string, unknown>): string {
  return Object.entries(record)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
    )
    .join(" · ");
}
