/** The longest passkey name auth-backend accepts. */
export const PASSKEY_NAME_MAX = 60;

const INVISIBLE = /[\p{Cc}\p{Cf}]/u;

/**
 * A passkey name as auth-backend stores it: trimmed, one line of printable
 * text, 1 to 60 characters; null when it would be refused. Shared by the
 * form in the browser and the server actions.
 */
export function passkeyName(value: string): string | null {
  const name = value.trim();
  return name.length > 0 &&
    name.length <= PASSKEY_NAME_MAX &&
    !INVISIBLE.test(name)
    ? name
    : null;
}
