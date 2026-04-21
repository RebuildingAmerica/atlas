import { spawnSync } from "node:child_process";
import type { SupportedOs } from "./types.js";

export function parseSemver(raw: string): number[] {
  return raw.replace(/^v/, "").replace(/^Python /, "").trim().split(".")
    .map(part => {
      const parsed = parseInt(part.replace(/\D+$/, ""), 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    });
}

export function isVersionGte(currentRaw: string, minimumRaw: string): boolean {
  const current = parseSemver(currentRaw);
  const minimum = parseSemver(minimumRaw);
  const max = Math.max(current.length, minimum.length);
  for (let i = 0; i < max; i++) {
    const c = current[i] ?? 0;
    const m = minimum[i] ?? 0;
    if (c > m) return true;
    if (c < m) return false;
  }
  return true;
}

export function detectOs(): SupportedOs | null {
  const result = spawnSync("uname", ["-s"], { stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) return null;
  const os = result.stdout.trim();
  if (os === "Darwin") return "macos";
  if (os === "Linux") return "linux";
  return null;
}
