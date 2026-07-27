import { describe, expect, it } from "vitest";

import { parseEnvBoolean } from "@/platform/config/env-boolean";

describe("parseEnvBoolean", () => {
  it("falls back when the variable is unset", () => {
    expect(parseEnvBoolean(undefined, true, "ATLAS_TEST_FLAG")).toBe(true);
    expect(parseEnvBoolean(undefined, false, "ATLAS_TEST_FLAG")).toBe(false);
  });

  it("falls back when the variable is empty or whitespace", () => {
    expect(parseEnvBoolean("", true, "ATLAS_TEST_FLAG")).toBe(true);
    expect(parseEnvBoolean("   ", false, "ATLAS_TEST_FLAG")).toBe(false);
  });

  it.each(["1", "on", "t", "true", "y", "yes", "TRUE", " Yes "])(
    "reads %s as true",
    (value: string) => {
      expect(parseEnvBoolean(value, false, "ATLAS_TEST_FLAG")).toBe(true);
    },
  );

  it.each(["0", "off", "f", "false", "n", "no", "FALSE", " No "])(
    "reads %s as false",
    (value: string) => {
      expect(parseEnvBoolean(value, true, "ATLAS_TEST_FLAG")).toBe(false);
    },
  );

  it("rejects a value that is not a recognized boolean", () => {
    expect(() => parseEnvBoolean("maybe", true, "ATLAS_TEST_FLAG")).toThrow(
      "ATLAS_TEST_FLAG must be a boolean value.",
    );
  });

  it("agrees with the API on the value that used to diverge", () => {
    // "0" previously resolved to true in the app and false in the API, so one
    // variable disabled rate limiting on one side and enabled it on the other.
    expect(parseEnvBoolean("0", true, "ATLAS_ANON_RATE_LIMIT_ENABLED")).toBe(false);
  });
});
