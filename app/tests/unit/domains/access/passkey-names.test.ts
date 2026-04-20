// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { nameFromAaguid, resolvePasskeyName } from "@/domains/access/passkey-names";

describe("passkey names", () => {
  it("maps known authenticator AAGUIDs and ignores privacy-preserving values", () => {
    expect(nameFromAaguid("fbfc3007-154e-4ecc-8c0b-6e020557d7bd")).toBe("iCloud Keychain");
    expect(nameFromAaguid("BADA5566-A7AA-401F-BD96-45619A55120D")).toBe("1Password");
    expect(nameFromAaguid("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(nameFromAaguid("unknown-aaguid")).toBeNull();
  });

  it("prefers explicit AAGUID names before platform heuristics", () => {
    expect(resolvePasskeyName("bada5566-a7aa-401f-bd96-45619a55120d")).toBe("1Password");
  });

  it("falls back to platform-specific names and a generic default", () => {
    const macNav = {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
      userAgentData: { platform: "macOS" },
    } as unknown as typeof navigator;
    expect(resolvePasskeyName(undefined, macNav)).toBe("Mac passkey");

    const iphoneNav = {
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      userAgentData: undefined,
    } as unknown as typeof navigator;
    expect(resolvePasskeyName(undefined, iphoneNav)).toBe("iPhone passkey");

    const winNav = {
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      userAgentData: undefined,
    } as unknown as typeof navigator;
    expect(resolvePasskeyName(undefined, winNav)).toBe("Windows passkey");

    const androidNav = {
      platform: "",
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
      userAgentData: undefined,
    } as unknown as typeof navigator;
    expect(resolvePasskeyName(undefined, androidNav)).toBe("Android passkey");

    const linuxNav = {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      userAgentData: undefined,
    } as unknown as typeof navigator;
    expect(resolvePasskeyName(undefined, linuxNav)).toBe("Linux passkey");

    const unknownNav = {
      platform: undefined,
      userAgent: undefined,
      userAgentData: {},
    } as unknown as typeof navigator;
    expect(resolvePasskeyName(undefined, unknownNav)).toBe("My passkey");

    const emptyNav = {
      platform: "",
      userAgent: "",
      userAgentData: undefined,
    } as unknown as typeof navigator;
    expect(resolvePasskeyName(undefined, emptyNav)).toBe("My passkey");

    expect(resolvePasskeyName(undefined, null)).toBe("My passkey");
  });
});
