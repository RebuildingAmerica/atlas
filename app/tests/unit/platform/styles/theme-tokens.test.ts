import { describe, expect, it } from "vitest";
import {
  REQUIRED_COLOR_TOKENS,
  darkModeBlock,
  readAppCss,
} from "@/../tests/helpers/styles/theme-tokens";

describe("theme tokens", () => {
  it("defines the semantic color contract for the light theme", () => {
    const appCss = readAppCss();
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(appCss).toContain(token);
    }
  });

  it("defines the semantic color contract for device dark mode", () => {
    const appCss = readAppCss();
    const block = darkModeBlock(appCss);

    expect(block).toBeDefined();
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(block).toContain(token);
    }
    expect(block).toContain("color-scheme: dark");
  });

  it("lets the device dark color-scheme override win the cascade", () => {
    const appCss = readAppCss();
    const lightSchemeIndex = appCss.indexOf(":root {\n  color-scheme: light;\n}");
    const darkSchemeIndex = appCss.indexOf("@media (prefers-color-scheme: dark)");

    expect(lightSchemeIndex).toBeGreaterThanOrEqual(0);
    expect(darkSchemeIndex).toBeGreaterThanOrEqual(0);
    expect(lightSchemeIndex).toBeLessThan(darkSchemeIndex);
  });

  it("does not introduce a manual theme switcher contract", () => {
    const appCss = readAppCss();
    expect(appCss).not.toMatch(/\.dark\b/);
    expect(appCss).not.toMatch(/\[data-theme/);
    expect(appCss).not.toMatch(/localStorage/i);
  });
});
