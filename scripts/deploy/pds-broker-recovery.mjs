import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, publicEncrypt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Read only these two fields. PLC/JWT keys, admin passwords and PDS data never
// leave the host, so existing accounts keep their identity during migration.
const remoteRead = `import json
from pathlib import Path
names = {"ATLAS_PDS_PUBLIC_URL": "origin", "ATLAS_PDS_INVITE_BROKER_SECRET": "brokerSecret"} # pragma: allowlist secret - field names only
result = {}
for line in Path("/opt/atlas-pds/pds.env").read_text().splitlines():
    key, separator, value = line.partition("=")
    if separator and key in names:
        if names[key] in result:
            raise RuntimeError("Duplicate broker setting")
        result[names[key]] = value
print(json.dumps(result))
`;

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw Error(`${key} is required.`);
  return value;
}

export function recoverPdsBroker({ env = process.env, run = spawnSync } = {}) {
  const origin = required(env, "ATLAS_PDS_PUBLIC_URL");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin)
    throw Error("A canonical HTTPS PDS origin is required.");
  const releaseSha = required(env, "GITHUB_SHA");
  if (!/^[a-f0-9]{40}$/.test(releaseSha))
    throw Error("A full release SHA is required.");
  const identities = [
    "ATLAS_PDS_INSTANCE_NAME",
    "GCP_PROJECT_ID",
    "ATLAS_PDS_INSTANCE_ZONE",
  ].map((key) => required(env, key));
  if (identities.some((value) => !/^[a-z][a-z0-9-]{0,62}$/.test(value)))
    throw Error("PDS host identity is invalid.");
  let recipient;
  try {
    recipient = createPublicKey({
      key: Buffer.from(required(env, "ATLAS_RECOVERY_PUBLIC_KEY"), "base64"),
      type: "spki",
      format: "der",
    });
    if (
      recipient.asymmetricKeyType !== "rsa" ||
      recipient.asymmetricKeyDetails.modulusLength !== 4096
    )
      throw Error("Invalid recipient");
  } catch {
    throw Error("Recovery requires an RSA-4096 public recipient key.");
  }
  const [instance, project, zone] = identities;
  const result = run(
    "gcloud",
    [
      "compute",
      "ssh",
      instance,
      "--project",
      project,
      "--zone",
      zone,
      "--tunnel-through-iap",
      "--quiet",
      "--ssh-key-expire-after=5m",
      "--command",
      `sudo python3 -c '${remoteRead}'`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
      maxBuffer: 64 * 1024,
    },
  );
  if (result.status !== 0)
    throw Error("PDS broker read failed; provider diagnostics suppressed.");
  const invalid = (category) => {
    throw Error(
      `PDS broker response is invalid (${category}); private diagnostics suppressed.`,
    );
  };
  let document;
  try {
    document = JSON.parse(result.stdout.toString());
  } catch {
    invalid("invalid-json");
  }
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    Object.keys(document).sort().join(",") !== "brokerSecret,origin"
  )
    invalid("invalid-fields");
  if (document.origin !== origin) invalid("origin-mismatch");
  if (
    typeof document.brokerSecret !== "string" || // pragma: allowlist secret - type name only
    !/^[A-Za-z0-9_+/=-]{16,256}$/.test(document.brokerSecret)
  )
    invalid("invalid-credential");
  if (Buffer.byteLength(JSON.stringify(document)) > 446)
    invalid("invalid-size");
  return {
    schemaVersion: 1,
    releaseSha,
    origin,
    algorithm: "RSA-OAEP-SHA256",
    recipientSha256: createHash("sha256")
      .update(recipient.export({ type: "spki", format: "der" }))
      .digest("hex"),
    ciphertext: publicEncrypt(
      { key: recipient, oaepHash: "sha256" },
      Buffer.from(JSON.stringify(document)),
    ).toString("base64"),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const envelope = recoverPdsBroker();
    const destination = ".atlas/pds-broker-recovery";
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    writeFileSync(
      `${destination}/broker.encrypted.json`,
      JSON.stringify(envelope, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Existing PDS broker setting encrypted for the supplied recipient.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
