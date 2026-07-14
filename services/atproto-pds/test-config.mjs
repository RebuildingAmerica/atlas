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
  assert.match(source, /\$\{ATLAS_PDS_DATA_DIRECTORY\}\/caddy-data:\/data/);
  assert.match(source, /\$\{ATLAS_PDS_DATA_DIRECTORY\}\/caddy-config:\/config/);
});

test("PDS VM bootstrap mounts the dedicated persistent disk before deploying containers", async () => {
  const source = await readFile(new URL("./vm-startup.sh", import.meta.url), "utf8");

  assert.match(source, /\/dev\/disk\/by-id\/google-atlas-pds-data/);
  assert.match(source, /mkfs\.ext4/);
  assert.match(source, /\/var\/lib\/atlas-pds/);
  assert.match(source, /docker\.service/);
});

test("PDS VM release materializes scoped secrets without persisting them in source control", async () => {
  const source = await readFile(new URL("./vm-release.sh", import.meta.url), "utf8");

  assert.match(source, /metadata\.google\.internal\/computeMetadata\/v1/);
  assert.match(source, /instance\/service-accounts\/default\/token/);
  assert.match(source, /ENVIRONMENT=.*ATLAS_PDS_ENVIRONMENT/);
  assert.match(source, /atlas-pds-\$\{ENVIRONMENT\}-admin-password/);
  assert.match(source, /atlas-pds-\$\{ENVIRONMENT\}-jwt-secret/);
  assert.match(source, /atlas-pds-\$\{ENVIRONMENT\}-plc-rotation-key/);
  assert.match(source, /umask 077/);
  assert.match(source, /pds\.env/);
  assert.match(source, /docker compose --env-file pds\.env -f compose\.hosted\.yaml up -d/);
});

test("PDS VM backup script captures and restores only the mounted runtime state", async () => {
  const source = await readFile(new URL("./vm-backup.sh", import.meta.url), "utf8");

  assert.match(source, /ATLAS_PDS_BACKUP_URI/);
  assert.match(source, /findmnt --target "\$DATA_DIRECTORY"/);
  assert.match(source, /tar --one-file-system --xattrs --acls -C "\$DATA_DIRECTORY" -czf/);
  assert.match(source, /sha256sum "\$archive"/);
  assert.match(source, /gcloud storage cp "\$source" "\$destination"/);
  assert.match(source, /ATLAS_PDS_RESTORE_CONFIRM=restore-\$ATLAS_PDS_ENVIRONMENT/);
  assert.match(source, /compose_down/);
  assert.match(source, /find "\$DATA_DIRECTORY"/);
  assert.match(source, /-exec mv -t "\$replaced_directory" -- \{\} \+/);
  assert.match(source, /tar --xattrs --acls -C "\$DATA_DIRECTORY" -xzf/);
});
