import { describe, expect, it } from "vitest";
import { getTypographyClass, typographyScale } from "@/styles/typography";

describe("typographyScale", () => {
  it("uses MD3 role names with semantic class names", () => {
    expect(typographyScale.displayLarge.className).toBe("type-display-large");
    expect(typographyScale.bodyMedium.className).toBe("type-body-medium");
    expect(typographyScale.labelSmall.className).toBe("type-label-small");
  });

  it("caps the largest role to a restrained maximum size", () => {
    expect(parseFloat(typographyScale.displayLarge.sizeRem)).toBeLessThanOrEqual(3);
  });
});

describe("getTypographyClass", () => {
  it("returns the class name for a supported MD3 role", () => {
    expect(getTypographyClass("headlineMedium")).toBe("type-headline-medium");
  });
});
