/** Page search params as Next.js passes them. */
export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;
export type Params<T extends string> = Promise<Record<T, string>>;

/** One value of a query parameter; empty strings count as absent. */
export function one(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  const text = Array.isArray(value) ? value[0] : value;
  return text && text.trim() !== "" ? text : undefined;
}

/** The value if it is one of the allowed ones (filters from the URL). */
export function oneOf<T extends string>(
  params: Record<string, string | string[] | undefined>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = one(params, key);
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = one(params, key)?.trim();
  return value && UUID.test(value) ? value : undefined;
}
