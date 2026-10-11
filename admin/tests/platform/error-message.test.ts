import { describe, expect, it } from "vitest";
import { errorMessage } from "@/platform/error-message";

describe("error messages", () => {
  it("shows the error's own sentence", () => {
    expect(errorMessage(new Error("The decision was saved."), "fallback")).toBe(
      "The decision was saved.",
    );
  });

  it.each([new Error(""), "a string", undefined])(
    "falls back when %s carries no message",
    (error) => {
      expect(errorMessage(error, "Discount requests could not load.")).toBe(
        "Discount requests could not load.",
      );
    },
  );
});
