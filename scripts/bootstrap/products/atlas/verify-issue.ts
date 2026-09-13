/** The vocabulary every Stripe verification check reports findings in. */

import type {
  StripeCatalogIssueCode,
  StripeCatalogVerificationIssue,
} from "./verify-types.js";

export function issue(
  code: StripeCatalogIssueCode,
  envKey: string,
  message: string,
): StripeCatalogVerificationIssue {
  return { code, envKey, message };
}

export function sameStringSet(
  actualItems: readonly string[],
  expectedItems: readonly string[],
): boolean {
  const actual = [...actualItems].sort();
  const expected = [...expectedItems].sort();
  return (
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}
