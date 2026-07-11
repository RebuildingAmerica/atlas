import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_COLOR_TOKENS = [
  "--color-background",
  "--color-on-background",
  "--color-surface",
  "--color-surface-container-lowest",
  "--color-surface-container-low",
  "--color-surface-container",
  "--color-surface-container-high",
  "--color-surface-container-highest",
  "--color-on-surface",
  "--color-on-surface-variant",
  "--color-outline",
  "--color-outline-variant",
  "--color-primary",
  "--color-on-primary",
  "--color-primary-container",
  "--color-on-primary-container",
  "--color-link",
  "--color-link-hover",
  "--color-success-container",
  "--color-on-success-container",
  "--color-warning-container",
  "--color-on-warning-container",
  "--color-error-container",
  "--color-on-error-container",
  "--color-footer-surface",
  "--color-on-footer-surface",
  "--color-footer-outline",
  "--color-public-grid-line",
] as const;

const helperDir = dirname(fileURLToPath(import.meta.url));

export function readAppCss(): string {
  return readFileSync(resolve(helperDir, "../../../src/styles/app.css"), "utf8");
}

export function darkModeBlock(appCss: string): string | undefined {
  return /@media\s+\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]+?\n\}/.exec(appCss)?.[0];
}
