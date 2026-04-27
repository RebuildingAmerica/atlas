#!/usr/bin/env node
/**
 * Materializes app/public/.well-known/mcp-registry-auth at build time from the
 * MCP_REGISTRY_AUTH_PUBKEY env var. The rendered file is the public-key
 * declaration the MCP Registry verifier fetches when authenticating publishes
 * for the org.rebuildingus namespace.
 *
 * The env var holds only the base64-encoded Ed25519 public key (the `p=`
 * value); this script owns the wrapper format so rotating the key requires
 * only a single env-var change plus redeploy. The rendered output is in
 * .gitignore — never committed.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(APP_ROOT, "public", ".well-known", "mcp-registry-auth");

async function main() {
  const pubkey = process.env.MCP_REGISTRY_AUTH_PUBKEY?.trim();
  if (!pubkey) {
    throw new Error(
      "MCP_REGISTRY_AUTH_PUBKEY is required to materialize /.well-known/mcp-registry-auth.",
    );
  }

  const payload = `v=MCPv1; k=ed25519; p=${pubkey}\n`;

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, payload, "utf8");

  console.log(`Wrote ${path.relative(APP_ROOT, OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
