import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./vm-release.sh", import.meta.url));
const secretKeys = [
  "PDS_ADMIN_PASSWORD",
  "PDS_JWT_SECRET",
  "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX",
];

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "atlas-pds-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  const deploy = join(directory, "deploy");
  await mkdir(bin);
  await mkdir(deploy);
  const values = {
    ATLAS_PDS_PUBLIC_URL: "https://pds.example.org",
    ATLAS_PDS_HOSTNAME: "pds.example.org",
    ATLAS_PDS_DATA_DIRECTORY: join(directory, "data"),
    ATLAS_PDS_INVITE_BROKER_SECRET: "synthetic-broker-fixture", // pragma: allowlist secret - disposable fixture
    ...Object.fromEntries(secretKeys.map((key) => [key, `retained-${key}`])),
    ...overrides,
  };
  const original =
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n";
  await writeFile(join(deploy, "pds.env"), original);
  await writeFile(join(bin, "findmnt"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await writeFile(
    join(bin, "curl"),
    `#!/bin/sh
for url; do :; done
printf '%s\\n' "$url" >> "$FIXTURE_CURL_LOG"
case "$url" in
  */default/token)
    [ "$FIXTURE_METADATA_FAILURE" != 1 ] || exit 22
    printf '{"access_token":"synthetic-metadata-fixture"}' # pragma: allowlist secret - disposable fixture
    ;;
  *)
    case "$url" in *"$FIXTURE_SECRET_FAILURE"*) exit 22;; esac
    value=$(printf 'synthetic-provider-value' | base64 | tr -d '\\n')
    printf '{"payload":{"data":"%s"}}' "$value"
    ;;
esac
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(bin, "docker"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FIXTURE_DOCKER_LOG"
case "$*" in
  *'config --quiet') [ "$FIXTURE_CONFIG_FAILURE" != 1 ] || exit 1;;
  *'ps -q atlas-pds') printf 'fixture-container';;
  inspect*) printf '%s' "$FIXTURE_HEALTH";;
esac
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    ATLAS_PDS_ENVIRONMENT: "production",
    ATLAS_PDS_GCP_PROJECT: "fixture-project",
    ATLAS_PDS_DEPLOY_DIRECTORY: deploy,
    ...Object.fromEntries(
      Object.entries(values).filter(([key]) => key.startsWith("ATLAS_")),
    ),
    FIXTURE_CURL_LOG: join(directory, "curl.log"),
    FIXTURE_DOCKER_LOG: join(directory, "docker.log"),
    FIXTURE_METADATA_FAILURE: "",
    FIXTURE_SECRET_FAILURE: "never-match", // pragma: allowlist secret - fake URL failure selector
    FIXTURE_HEALTH: "healthy",
    FIXTURE_CONFIG_FAILURE: "",
  };
  return {
    original,
    envFile: join(deploy, "pds.env"),
    run: (args = [], extra = {}) =>
      spawnSync("bash", [script, ...args], {
        env: { ...env, ...extra },
        encoding: "utf8",
        timeout: 10000,
      }),
    dockerLog: async () =>
      readFile(env.FIXTURE_DOCKER_LOG, "utf8").catch(() => ""),
    curlLog: async () => readFile(env.FIXTURE_CURL_LOG, "utf8").catch(() => ""),
  };
}

for (const secret of ["admin-password", "jwt-secret", "plc-rotation-key"]) {
  test(`a denied ${secret} read preserves the running configuration`, async (t) => {
    const f = await fixture(t);
    const result = f.run([], { FIXTURE_SECRET_FAILURE: secret });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(f.envFile, "utf8"), f.original);
    assert.equal(await f.dockerLog(), "");
  });
}

test("a denied metadata token read stops before replacing configuration", async (t) => {
  const f = await fixture(t);
  assert.notEqual(f.run([], { FIXTURE_METADATA_FAILURE: "1" }).status, 0);
  assert.equal(await readFile(f.envFile, "utf8"), f.original);
  assert.equal(await f.dockerLog(), "");
});

test("a full release writes complete credentials before starting containers", async (t) => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const retained = await readFile(f.envFile, "utf8");
  for (const key of secretKeys) {
    assert.match(
      retained,
      new RegExp(`^${key}=synthetic-provider-value$`, "m"),
    );
  }
  assert.match(await f.dockerLog(), /up -d\n/);
});

test("invalid compose configuration preserves the previous credentials", async (t) => {
  const f = await fixture(t);
  assert.notEqual(f.run([], { FIXTURE_CONFIG_FAILURE: "1" }).status, 0);
  assert.equal(await readFile(f.envFile, "utf8"), f.original);
  assert.doesNotMatch(await f.dockerLog(), /up |restart|down/);
});

test("broker updates retain credentials and never restart the PDS", async (t) => {
  const f = await fixture(t);
  const result = f.run(["--broker-only"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(f.envFile, "utf8"), f.original);
  assert.equal(await f.curlLog(), "");
  const commands = await f.dockerLog();
  assert.match(
    commands,
    /up -d --no-deps --force-recreate atlas-pds-invite-broker atlas-pds-edge/,
  );
  assert.doesNotMatch(commands, /up -d(?:\n|$)/);
});

test("broker updates reject incomplete retained credentials before any container changes", async (t) => {
  const f = await fixture(t, { PDS_JWT_SECRET: "" });
  assert.notEqual(f.run(["--broker-only"]).status, 0);
  assert.equal(await readFile(f.envFile, "utf8"), f.original);
  assert.doesNotMatch(await f.dockerLog(), /up |restart|down/);
  assert.equal(await f.curlLog(), "");
});

test("broker updates require a healthy existing PDS", async (t) => {
  const f = await fixture(t);
  assert.notEqual(
    f.run(["--broker-only"], { FIXTURE_HEALTH: "unhealthy" }).status,
    0,
  );
  assert.equal(await readFile(f.envFile, "utf8"), f.original);
  assert.doesNotMatch(await f.dockerLog(), /up |restart|down/);
});

test("broker updates reject changed deployment inputs", async (t) => {
  const f = await fixture(t);
  assert.notEqual(
    f.run(["--broker-only"], { ATLAS_PDS_HOSTNAME: "changed.example.org" })
      .status,
    0,
  );
  assert.equal(await readFile(f.envFile, "utf8"), f.original);
  assert.equal(await f.dockerLog(), "");
  assert.equal(await f.curlLog(), "");
});
