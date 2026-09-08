import "@tanstack/react-start/server-only";

interface BillingFlagOptions {
  /** Value to use when the variable is absent or empty. */
  readonly whenUnset: boolean;
}

/**
 * Reads a billing boolean environment flag, refusing values it cannot parse.
 *
 * The repo forbids silent defaults, and billing is where that rule earns its
 * keep: `ATLAS_BILLING_AUTOMATIC_TAX=off` parsed loosely means a quarter of
 * uncollected tax, and `ATLAS_BILLING_CHECKOUT_ENABLED=1` parsed loosely
 * means either selling a dead product or refusing every sale. Only "true" and
 * "false" are accepted, so a typo fails the request instead of choosing for
 * the operator.
 *
 * @param name - Environment variable to read.
 * @param options - The value to use when the variable is unset.
 * @returns The parsed flag.
 * @throws When the variable holds anything other than "true" or "false".
 */
export function readBillingFlag(name: string, options: BillingFlagOptions): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return options.whenUnset;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(`${name} must be "true" or "false", not ${JSON.stringify(process.env[name])}.`);
}
