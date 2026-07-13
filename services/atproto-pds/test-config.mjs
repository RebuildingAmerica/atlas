import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredKeys = [
  "ATLAS_PDS_PUBLIC_URL",
  "ATLAS_PDS_DATA_DIRECTORY",
  "PDS_ADMIN_PASSWORD",
  "PDS_JWT_SECRET",
  "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX",
];

function parseEnv(source) {
  return new Map(
    source
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=", 2))
      .filter(([key, value]) => key && value),
  );
}

test("managed PDS example declares a secure public endpoint and required secrets", async () => {
  const source = await readFile(new URL("./pds.env.example", import.meta.url), "utf8");
  const env = parseEnv(source);

  for (const key of requiredKeys) {
    assert.ok(env.has(key), `missing ${key}`);
  }

  const publicUrl = env.get("ATLAS_PDS_PUBLIC_URL");
  assert.ok(publicUrl);
  const parsed = new URL(publicUrl);
  assert.equal(parsed.protocol, "https:");
  assert.ok(parsed.hostname.includes("."));
});

test("hosted PDS manifest isolates durable PDS data behind its own TLS edge", async () => {
  const source = await readFile(new URL("./compose.hosted.yaml", import.meta.url), "utf8");

  assert.match(source, /^  atlas-pds:/m);
  assert.match(source, /^  atlas-pds-edge:/m);
  assert.match(source, /- \$\{ATLAS_PDS_DATA_DIRECTORY\}:\/pds/);
  assert.match(source, /- "80:80"/);
  assert.match(source, /- "443:443"/);
  assert.match(source, /\.\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
});

test("PDS VM bootstrap mounts the dedicated persistent disk before deploying containers", async () => {
  const source = await readFile(new URL("./vm-startup.sh", import.meta.url), "utf8");

  assert.match(source, /\/dev\/disk\/by-id\/google-atlas-pds-data/);
  assert.match(source, /mkfs\.ext4/);
  assert.match(source, /\/var\/lib\/atlas-pds/);
  assert.match(source, /docker\.service/);
});
