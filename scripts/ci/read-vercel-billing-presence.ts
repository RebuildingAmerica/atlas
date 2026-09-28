#!/usr/bin/env tsx
/** Resolve only Production setting names, never their encrypted values. */
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const requiredNames = [
  "STRIPE_API_KEY",
  "STRIPE_ATLAS_CATALOG",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_BILLING_PORTAL_CONFIGURATION",
  "ATLAS_BILLING_ALLOWED_OFFERS",
];

export function productionBillingNames(
  metadata: unknown,
): { name: string; present: boolean }[] {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("envs" in metadata) ||
    !Array.isArray(metadata.envs)
  ) {
    throw new TypeError("Invalid Vercel environment metadata.");
  }
  const records: unknown[] = metadata.envs;
  const names = new Set(
    records.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const key =
        "key" in item && typeof item.key === "string" ? item.key : null;
      const target =
        "target" in item && Array.isArray(item.target) ? item.target : [];
      return key && target.includes("production") ? [key] : [];
    }),
  );
  return requiredNames.map((name) => ({ name, present: names.has(name) }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const names = productionBillingNames(JSON.parse(readFileSync(0, "utf8")));
    for (const { name, present } of names) {
      const line = `ATLAS_VERCEL_${name}_PRESENT=${present}`;
      if (process.env.GITHUB_ENV)
        appendFileSync(process.env.GITHUB_ENV, `${line}\n`);
      console.log(
        `${name}: ${present ? "present by name" : "not configured by name"}`,
      );
    }
  } catch {
    console.error("Cannot inspect Vercel Production setting names.");
    process.exitCode = 1;
  }
}
