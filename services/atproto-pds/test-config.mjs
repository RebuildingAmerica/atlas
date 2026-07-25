import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredKeys = [
  "ATLAS_PDS_PUBLIC_URL",
  "ATLAS_PDS_DATA_DIRECTORY",
  "ATLAS_PDS_INVITE_BROKER_SECRET",
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
  const source = await readFile(
    new URL("./pds.env.example", import.meta.url),
    "utf8",
  );
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
  const source = await readFile(
    new URL("./compose.hosted.yaml", import.meta.url),
    "utf8",
  );

  assert.match(source, /^  atlas-pds:/m);
  assert.match(source, /^  atlas-pds-invite-broker:/m);
  assert.match(source, /^  atlas-pds-edge:/m);
  assert.match(source, /- \$\{ATLAS_PDS_DATA_DIRECTORY\}:\/pds/);
  assert.match(
    source,
    /ATLAS_PDS_INVITE_BROKER_SECRET: \$\{ATLAS_PDS_INVITE_BROKER_SECRET\}/,
  );
  assert.match(source, /PDS_ADMIN_PASSWORD: \$\{PDS_ADMIN_PASSWORD\}/);
  assert.match(source, /\.\/invite-broker\.mjs:\/app\/invite-broker\.mjs:ro/);
  assert.doesNotMatch(source, /2584:2584/);
  assert.match(source, /- "80:80"/);
  assert.match(source, /- "443:443"/);
  assert.match(source, /\.\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
  assert.match(source, /\$\{ATLAS_PDS_DATA_DIRECTORY\}\/caddy-data:\/data/);
  assert.match(source, /\$\{ATLAS_PDS_DATA_DIRECTORY\}\/caddy-config:\/config/);
});

test("hosted PDS edge exposes only the invite broker route before proxying PDS traffic", async () => {
  const source = await readFile(
    new URL("./Caddyfile", import.meta.url),
    "utf8",
  );

  assert.match(source, /handle \/_atlas\/pds\/invites/);
  assert.match(source, /reverse_proxy atlas-pds-invite-broker:2584/);
  assert.match(source, /handle\s*\{\s*reverse_proxy atlas-pds:2583\s*\}/);
  assert.ok(
    source.indexOf("atlas-pds-invite-broker:2584") <
      source.indexOf("atlas-pds:2583"),
    "invite broker route must be matched before the catch-all PDS proxy",
  );
});

test("PDS VM bootstrap mounts the dedicated persistent disk before deploying containers", async () => {
  const source = await readFile(
    new URL("./vm-startup.sh", import.meta.url),
    "utf8",
  );

  assert.match(source, /\/dev\/disk\/by-id\/google-atlas-pds-data/);
  assert.match(source, /mkfs\.ext4/);
  assert.match(source, /\/var\/lib\/atlas-pds/);
  assert.match(source, /docker\.service/);
});

test("vm-backup.sh does not reference function-local variables from its EXIT trap", async () => {
  const source = await readFile(
    new URL("./vm-backup.sh", import.meta.url),
    "utf8",
  );

  const trapVarNames = new Set();
  for (const trapMatch of source.matchAll(/trap\s+'([^']*)'\s+EXIT/g)) {
    for (const varMatch of trapMatch[1].matchAll(/\$\{?(\w+)\}?/g)) {
      trapVarNames.add(varMatch[1]);
    }
  }
  assert.ok(
    trapVarNames.size > 0,
    "expected at least one EXIT trap referencing variables",
  );

  for (const name of trapVarNames) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\blocal\\s+${name}\\b`),
      `${name} is referenced by an EXIT trap but declared \`local\` inside a function — it goes out ` +
        "of scope once the function returns, before the trap fires at script exit, causing an " +
        "unbound-variable error under `set -u`",
    );
  }
});

test("PDS VM release materializes scoped secrets without persisting them in source control", async () => {
  const source = await readFile(
    new URL("./vm-release.sh", import.meta.url),
    "utf8",
  );

  assert.match(source, /metadata\.google\.internal\/computeMetadata\/v1/);
  assert.match(source, /instance\/service-accounts\/default\/token/);
  assert.match(source, /ENVIRONMENT=.*ATLAS_PDS_ENVIRONMENT/);
  assert.match(source, /atlas-pds-\$\{ENVIRONMENT\}-admin-password/);
  assert.match(source, /atlas-pds-\$\{ENVIRONMENT\}-jwt-secret/);
  assert.match(source, /atlas-pds-\$\{ENVIRONMENT\}-plc-rotation-key/);
  assert.match(source, /ATLAS_PDS_INVITE_BROKER_SECRET/);
  assert.match(source, /secrets\.token_urlsafe\(48\)/);
  assert.match(source, /umask 077/);
  assert.match(source, /pds\.env/);
  assert.match(
    source,
    /docker compose --env-file pds\.env -f compose\.hosted\.yaml up -d/,
  );
});

test("invite broker implementation only mints one-use invites for authorized callers", async () => {
  const source = await readFile(
    new URL("./invite-broker.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /ATLAS_PDS_INVITE_BROKER_SECRET/);
  assert.match(source, /PDS_ADMIN_PASSWORD/);
  assert.match(source, /\/_atlas\/pds\/invites/);
  assert.match(
    source,
    /request\.headers\.authorization !== `Bearer \$\{brokerSecret\}`/,
  );
  assert.match(source, /JSON\.stringify\(\{ useCount \}\)/);
  assert.match(source, /useCount < 1 \|\| useCount > 1/);
  assert.match(source, /com\.atproto\.server\.createInviteCode/);
  assert.doesNotMatch(source, /console\.log\(.*brokerSecret/);
  assert.doesNotMatch(source, /console\.log\(.*pdsAdminPassword/);
});

test("PDS VM backup script captures and restores only the mounted runtime state", async () => {
  const source = await readFile(
    new URL("./vm-backup.sh", import.meta.url),
    "utf8",
  );

  assert.match(source, /ATLAS_PDS_BACKUP_URI/);
  assert.match(source, /findmnt --target "\$DATA_DIRECTORY"/);
  assert.match(
    source,
    /tar --one-file-system --xattrs --acls -C "\$DATA_DIRECTORY" -czf/,
  );
  assert.match(source, /sha256sum "\$archive"/);
  assert.match(source, /gcloud storage cp "\$source" "\$destination"/);
  assert.match(
    source,
    /ATLAS_PDS_RESTORE_CONFIRM=restore-\$ATLAS_PDS_ENVIRONMENT/,
  );
  assert.match(source, /compose_down/);
  assert.match(source, /find "\$DATA_DIRECTORY"/);
  assert.match(source, /-exec mv -t "\$replaced_directory" -- \{\} \+/);
  assert.match(source, /tar --xattrs --acls -C "\$DATA_DIRECTORY" -xzf/);
});
