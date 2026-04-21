import { randomBytes } from "node:crypto";

export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

const PLACEHOLDER_PATTERNS = [
  /^replace-with-/,
  /^your-.*-here$/,
  /^xxx$/,
  /^changeme$/,
  /^TODO$/i,
];

export function isPlaceholder(value: string): boolean {
  if (!value || value === "") return true;
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value));
}
