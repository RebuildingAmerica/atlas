// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  readLastUsedAtlasEmail,
  rememberLastUsedAtlasEmail,
} from "@/domains/access/client/last-used-email";

describe("last-used-email (SSR)", () => {
  it("returns null when window is unavailable", () => {
    expect(readLastUsedAtlasEmail()).toBeNull();
  });

  it("is a no-op when window is unavailable", () => {
    expect(() => {
      rememberLastUsedAtlasEmail("operator@atlas.test");
    }).not.toThrow();
  });
});
