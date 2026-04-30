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

  it("returns an empty list when the stored value is not an array", () => {
    window.localStorage.setItem("atlas:sso-diagnostics-log", JSON.stringify({ code: "anything" }));
    expect(readSsoDiagnostics()).toEqual([]);
  });

  it("skips entries that are missing recordedAt or are non-objects", () => {
    window.localStorage.setItem(
      "atlas:sso-diagnostics-log",
      JSON.stringify([
        null,
        "string",
        { code: "no-timestamp" },
        { recordedAt: "2026-04-29T00:00:00.000Z", code: "ok" },
      ]),
    );
    const entries = readSsoDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.code).toBe("ok");
  });

  it("drops empty-string fields back to null on read", () => {
    window.localStorage.setItem(
      "atlas:sso-diagnostics-log",
      JSON.stringify([
        {
          recordedAt: "2026-04-29T00:00:00.000Z",
          code: "",
          email: "",
          message: "",
          workspaceSlug: "",
        },
      ]),
    );
    const entries = readSsoDiagnostics();
    expect(entries[0]).toEqual({
      code: null,
      email: null,
      message: null,
      recordedAt: "2026-04-29T00:00:00.000Z",
      workspaceSlug: null,
    });
  });
});
