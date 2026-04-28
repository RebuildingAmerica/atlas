// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  readLastUsedAtlasEmail,
  rememberLastUsedAtlasEmail,
} from "@/domains/access/client/last-used-email";

describe("last-used-email", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(readLastUsedAtlasEmail()).toBeNull();
  });

  it("round-trips a remembered email", () => {
    rememberLastUsedAtlasEmail("operator@atlas.test");
    expect(readLastUsedAtlasEmail()).toBe("operator@atlas.test");
  });

  it("clears the stored value when remembering an empty string", () => {
    rememberLastUsedAtlasEmail("operator@atlas.test");
    rememberLastUsedAtlasEmail("   ");
    expect(readLastUsedAtlasEmail()).toBeNull();
  });
});
