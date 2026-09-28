#!/usr/bin/env node
/** Check Vercel Production setting names without reading or printing their values. */
import { readFileSync } from "node:fs";

const required = [
  "STRIPE_API_KEY",
  "STRIPE_ATLAS_CATALOG",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_BILLING_PORTAL_CONFIGURATION",
  "ATLAS_BILLING_ALLOWED_OFFERS",
];

let envs;
try {
  const metadata = JSON.parse(readFileSync(0, "utf8"));
  if (!Array.isArray(metadata.envs)) {
    throw new TypeError("envs must be an array");
  }
  envs = metadata.envs;
} catch {
  console.error(
    "Invalid Vercel environment metadata; production billing preflight failed.",
  );
  process.exitCode = 1;
}

if (envs) {
  const productionNames = new Set(
    envs
      .filter(
        (item) =>
          item &&
          typeof item.key === "string" &&
          Array.isArray(item.target) &&
          item.target.includes("production"),
      )
      .map((item) => item.key),
  );
  const missing = required.filter((key) => !productionNames.has(key));
  if (missing.length > 0) {
    console.error(
      `Production billing settings missing: ${missing.join(", ")}.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      "Production billing settings are present by name; values and payment still need proof.",
    );
  }
}
