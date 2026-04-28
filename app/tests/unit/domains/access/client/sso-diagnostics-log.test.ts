// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSsoDiagnostics,
  readSsoDiagnostics,
  recordSsoDiagnostics,
} from "@/domains/access/client/sso-diagnostics-log";

describe("sso-diagnostics-log", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    clearSsoDiagnostics();
  });

  it("returns an empty list when nothing is recorded", () => {
    expect(readSsoDiagnostics()).toEqual([]);
  });

  it("records and reads back entries newest-first", () => {
    recordSsoDiagnostics({
      code: "certificate_invalid",
      email: "user@atlas.test",
      message: "msg",
      workspaceSlug: "atlas",
    });
    recordSsoDiagnostics({
      code: "domain_not_verified",
      email: "user@atlas.test",
      message: null,
      workspaceSlug: null,
    });
    const entries = readSsoDiagnostics();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.code).toBe("domain_not_verified");
    expect(entries[1]?.code).toBe("certificate_invalid");
  });

  it("clears the log on demand", () => {
    recordSsoDiagnostics({
      code: "any",
      email: null,
      message: null,
      workspaceSlug: null,
    });
    clearSsoDiagnostics();
    expect(readSsoDiagnostics()).toEqual([]);
  });

  it("drops malformed payloads instead of throwing", () => {
    window.localStorage.setItem("atlas:sso-diagnostics-log", "not-json");
    expect(readSsoDiagnostics()).toEqual([]);
  });
});
