import { describe, expect, it } from "vitest";

describe("Playwright configuration", () => {
  it("loads the access JWT audience helper through its package export", async () => {
    await expect(import("../../playwright.config")).resolves.toHaveProperty("default");
  });
});
