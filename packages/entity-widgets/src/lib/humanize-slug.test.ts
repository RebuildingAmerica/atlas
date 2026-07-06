import { describe, expect, it } from "vitest";
import { humanizeSlug } from "./humanize-slug";

describe("humanizeSlug", () => {
  it("title-cases a hyphenated slug", () => {
    expect(humanizeSlug("criminal-justice")).toBe("Criminal Justice");
  });

  it("title-cases an underscored slug", () => {
    expect(humanizeSlug("pending_review")).toBe("Pending Review");
  });

  it("title-cases a single word", () => {
    expect(humanizeSlug("housing")).toBe("Housing");
  });

  it("collapses a run of separators instead of emitting an empty word", () => {
    expect(humanizeSlug("foo--bar")).toBe("Foo Bar");
  });
});
