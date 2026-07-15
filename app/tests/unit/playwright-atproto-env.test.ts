import { describe, expect, it } from "vitest";
import {
  resolveAtprotoOAuthHarnessMode,
  resolveAtprotoPdsHarnessMode,
} from "../../playwright-atproto-env";

describe("resolveAtprotoOAuthHarnessMode", () => {
  it("uses the internal provider harness by default", () => {
    expect(resolveAtprotoOAuthHarnessMode({})).toBe("1");
  });

  it("honors an explicit harness override", () => {
    expect(
      resolveAtprotoOAuthHarnessMode({
        ATLAS_ATPROTO_OAUTH_E2E_HARNESS: "0",
      }),
    ).toBe("0");
    expect(
      resolveAtprotoOAuthHarnessMode({
        ATLAS_ATPROTO_OAUTH_E2E_HARNESS: "1",
      }),
    ).toBe("1");
  });

  it("rejects invalid explicit harness overrides", () => {
    expect(() => {
      resolveAtprotoOAuthHarnessMode({
        ATLAS_ATPROTO_OAUTH_E2E_HARNESS: "true",
      });
    }).toThrow("ATLAS_ATPROTO_OAUTH_E2E_HARNESS must be 0 or 1.");
  });
});

describe("resolveAtprotoPdsHarnessMode", () => {
  it("uses the internal PDS harness by default", () => {
    expect(resolveAtprotoPdsHarnessMode({})).toBe("1");
  });

  it("honors an explicit PDS harness override", () => {
    expect(
      resolveAtprotoPdsHarnessMode({
        ATLAS_ATPROTO_PDS_E2E_HARNESS: "0",
      }),
    ).toBe("0");
    expect(
      resolveAtprotoPdsHarnessMode({
        ATLAS_ATPROTO_PDS_E2E_HARNESS: "1",
      }),
    ).toBe("1");
  });

  it("rejects invalid explicit PDS harness overrides", () => {
    expect(() => {
      resolveAtprotoPdsHarnessMode({
        ATLAS_ATPROTO_PDS_E2E_HARNESS: "true",
      });
    }).toThrow("ATLAS_ATPROTO_PDS_E2E_HARNESS must be 0 or 1.");
  });
});
