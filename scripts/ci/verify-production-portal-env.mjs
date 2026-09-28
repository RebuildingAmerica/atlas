#!/usr/bin/env node
/** Confirm that Vercel accepted the portal setting without reading its value. */
import { readFileSync } from "node:fs";

let envs;
try {
  const metadata = JSON.parse(readFileSync(0, "utf8"));
  if (!Array.isArray(metadata.envs)) {
    throw new TypeError("envs must be an array");
  }
  envs = metadata.envs;
} catch {
  console.error(
    "Invalid Vercel environment metadata; portal presence is unverified.",
  );
  process.exitCode = 1;
}

if (envs) {
  const portalPresent = envs.some(
    (item) =>
      item?.key === "STRIPE_BILLING_PORTAL_CONFIGURATION" &&
      Array.isArray(item.target) &&
      item.target.includes("production"),
  );
  if (!portalPresent) {
    console.error("Vercel Production does not list the Atlas portal setting.");
    process.exitCode = 1;
  } else {
    console.log(
      "Vercel Production lists the Atlas portal setting; its value is not readable here.",
    );
  }
}
