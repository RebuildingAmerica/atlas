import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredKeys = [
  "ATLAS_PDS_PUBLIC_URL",
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
