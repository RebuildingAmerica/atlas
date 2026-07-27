/**
 * Boolean environment parsing shared by every app-side config resolver.
 *
 * The API parses booleans through pydantic. When the app parsed them
 * differently, one variable meant two things: `ATLAS_ANON_RATE_LIMIT_ENABLED=0`
 * disabled rate limiting in the API and enabled it in the app, because the app
 * treated anything but the literal "false" as true. These sets mirror pydantic's
 * accepted values so both runtimes read one variable the same way, and anything
 * outside them fails loudly rather than resolving to a silent default.
 */
const TRUE_VALUES: ReadonlySet<string> = new Set(["1", "on", "t", "true", "y", "yes"]);
const FALSE_VALUES: ReadonlySet<string> = new Set(["0", "off", "f", "false", "n", "no"]);

/**
 * Parses a boolean environment variable.
 *
 * @param value - Raw environment value, if present.
 * @param fallback - Value used when the variable is unset or empty.
 * @param label - Variable name, used in the error message.
 * @returns The parsed boolean.
 * @throws When the value is present but is not a recognized boolean.
 */
export function parseEnvBoolean(
  value: string | undefined,
  fallback: boolean,
  label: string,
): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  throw new Error(`${label} must be a boolean value.`);
}
