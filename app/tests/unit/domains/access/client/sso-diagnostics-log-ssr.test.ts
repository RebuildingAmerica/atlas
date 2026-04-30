// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  clearSsoDiagnostics,
  readSsoDiagnostics,
  recordSsoDiagnostics,
} from "@/domains/access/client/sso-diagnostics-log";

describe("sso-diagnostics-log (SSR)", () => {
  it("returns an empty list when window is unavailable", () => {
    expect(readSsoDiagnostics()).toEqual([]);
  });

  it("is a no-op when window is unavailable", () => {
    expect(() => {
      recordSsoDiagnostics({
        code: "any",
        email: null,
        message: null,
        workspaceSlug: null,
      });
    }).not.toThrow();
    expect(() => {
      clearSsoDiagnostics();
    }).not.toThrow();
  });
});
