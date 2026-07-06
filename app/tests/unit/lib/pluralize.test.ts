import { describe, expect, it } from "vitest";
import { pluralize } from "@/lib/pluralize";

describe("pluralize", () => {
  it("uses the singular form when count is 1", () => {
    expect(pluralize(1, "source packet")).toBe("1 source packet");
  });

  it("uses the default plural form when count is 0", () => {
    expect(pluralize(0, "source packet")).toBe("0 source packets");
  });

  it("uses the default plural form when count is greater than 1", () => {
    expect(pluralize(3, "source packet")).toBe("3 source packets");
  });

  it("uses an explicit plural form when provided", () => {
    expect(pluralize(3, "lead", "leads")).toBe("3 leads");
    expect(pluralize(1, "lead", "leads")).toBe("1 lead");
  });
});
