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
  it("returns the class name for all supported MD3 roles", () => {
    expect(getTypographyClass("displayLarge")).toBe("type-display-large");
    expect(getTypographyClass("displayMedium")).toBe("type-display-medium");
    expect(getTypographyClass("displaySmall")).toBe("type-display-small");
    expect(getTypographyClass("headlineLarge")).toBe("type-headline-large");
    expect(getTypographyClass("headlineMedium")).toBe("type-headline-medium");
    expect(getTypographyClass("headlineSmall")).toBe("type-headline-small");
    expect(getTypographyClass("titleLarge")).toBe("type-title-large");
    expect(getTypographyClass("titleMedium")).toBe("type-title-medium");
    expect(getTypographyClass("titleSmall")).toBe("type-title-small");
    expect(getTypographyClass("bodyLarge")).toBe("type-body-large");
    expect(getTypographyClass("bodyMedium")).toBe("type-body-medium");
    expect(getTypographyClass("bodySmall")).toBe("type-body-small");
    expect(getTypographyClass("labelLarge")).toBe("type-label-large");
    expect(getTypographyClass("labelMedium")).toBe("type-label-medium");
    expect(getTypographyClass("labelSmall")).toBe("type-label-small");
  });
});
