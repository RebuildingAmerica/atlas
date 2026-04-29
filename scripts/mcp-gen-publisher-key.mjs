#!/usr/bin/env node
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const KEY_DIR = join(homedir(), ".config", "mcp-publisher");
const PRIV_PATH = join(KEY_DIR, "atlas.key");
const PUB_PATH = join(KEY_DIR, "atlas.pub");

const { values } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
    "stdout-only": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: pnpm mcp:gen-publisher-key [--force] [--stdout-only]

Generates an Ed25519 keypair for the Atlas MCP Registry publisher (DNS-based
domain proof on rebuildingus.org).

By default, writes the keypair to:
  ${PRIV_PATH}  (private, hex-encoded, chmod 600)
  ${PUB_PATH}  (public, base64-encoded)

Aborts if either file already exists, unless --force is passed.

Flags:
  --force         Overwrite existing key files.
  --stdout-only   Print PUB_BASE64 and PRIV_HEX to stdout; do not write files.
  -h, --help      Show this help.

Next steps after running:
  1. Update the rebuildingus.org TXT record (apex, type TXT, TTL 60) with:
       v=MCPv1; k=ed25519; p=<PUB_BASE64>
  2. Wait one TTL, then verify:
       dig +short rebuildingus.org TXT @1.1.1.1 | grep MCPv1
  3. Authenticate with the registry:
       mcp-publisher login dns --domain rebuildingus.org \\
         --private-key "$(cat ${PRIV_PATH})"

See docs/runbooks/mcp-registry-publish.md for the full publish/rotate flow.
`);
  process.exit(0);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubBase64 = publicKey.export({ type: "spki", format: "der" }).slice(12).toString("base64");
const privHex = privateKey.export({ type: "pkcs8", format: "der" }).slice(-32).toString("hex");

if (values["stdout-only"]) {
  console.log(`PUB_BASE64=${pubBase64}`);
  console.log(`PRIV_HEX=${privHex}`);
  process.exit(0);
}

if (!values.force && (existsSync(PRIV_PATH) || existsSync(PUB_PATH))) {
  console.error(`error: ${PRIV_PATH} or ${PUB_PATH} already exists.`);
  console.error("       Pass --force to overwrite, or --stdout-only to skip writing.");
  process.exit(1);
}

mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
writeFileSync(PRIV_PATH, `${privHex}\n`, { mode: 0o600 });
writeFileSync(PUB_PATH, `${pubBase64}\n`, { mode: 0o644 });

console.log(`✓ Wrote private key → ${PRIV_PATH} (chmod 600)`);
console.log(`✓ Wrote public key  → ${PUB_PATH}`);
console.log("");
console.log("Public key (paste into Cloudflare TXT record on rebuildingus.org apex):");
console.log("");
console.log(`  v=MCPv1; k=ed25519; p=${pubBase64}`);
console.log("");
console.log("Then verify with:");
console.log("  dig +short rebuildingus.org TXT @1.1.1.1 | grep MCPv1");
console.log("");
console.log("Login with:");
console.log(`  mcp-publisher login dns --domain rebuildingus.org --private-key "$(cat ${PRIV_PATH})"`);
