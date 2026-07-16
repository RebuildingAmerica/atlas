// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { signalUnknownPasskey } from "@rebuildingamerica/atlas-access/passkey-signal";

describe("signalUnknownPasskey", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  });

  it("does nothing when PublicKeyCredential is unavailable", () => {
    expect(() => {
      signalUnknownPasskey("cred-123");
    }).not.toThrow();
  });

  it("does nothing when signalUnknownCredential is not a function", () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: {},
    });

    expect(() => {
      signalUnknownPasskey("cred-123");
    }).not.toThrow();
  });

  it("calls signalUnknownCredential with the current hostname and credential id", () => {
    const signalUnknownCredential = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: { signalUnknownCredential },
    });

    signalUnknownPasskey("cred-123");

    expect(signalUnknownCredential).toHaveBeenCalledWith({
      rpId: window.location.hostname,
      credentialId: "cred-123",
    });
  });

  it("swallows a rejection from signalUnknownCredential", async () => {
    const signalUnknownCredential = vi.fn().mockRejectedValue(new Error("not supported"));
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: { signalUnknownCredential },
    });

    expect(() => {
      signalUnknownPasskey("cred-123");
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(signalUnknownCredential).toHaveBeenCalled();
    });
  });
});
