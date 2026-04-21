import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function parseEnvFile(filePath: string): Map<string, string> {
  const entries = new Map<string, string>();
  if (!existsSync(filePath)) return entries;

  const content = readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  return entries;
}

export function mergeEnvFile(
  filePath: string,
  updates: Map<string, string>,
): void {
  // Read existing file preserving comments and ordering
  let content = "";
  if (existsSync(filePath)) {
    content = readFileSync(filePath, "utf8");
  }

  const existingKeys = new Set<string>();
  const lines = content.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      result.push(line);
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      result.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    existingKeys.add(key);
    if (updates.has(key)) {
      result.push(`${key}=${quoteEnvValue(updates.get(key)!)}`);
    } else {
      result.push(line);
    }
  }

  // Append new keys not in existing file
  for (const [key, value] of updates) {
    if (!existingKeys.has(key)) {
      result.push(`${key}=${quoteEnvValue(value)}`);
    }
  }

  writeFileSync(filePath, result.join("\n"));
}

function quoteEnvValue(value: string): string {
  if (value.includes(" ") || value.includes('"') || value.includes("'") ||
      value.includes("#") || value.includes("\n")) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
