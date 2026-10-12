import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBuildOutput } from "@cloudflare/build-output-utils";
import { preparePythonOutput } from "./api-cloudflare-output.mjs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

test("Python artifacts are portable cf Build Output with vendored package data", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-python-output-"));
  try {
    const source = join(root, "source"),
      vendor = join(root, "vendor");
    mkdirSync(source);
    const production = join(root, "production");
    mkdirSync(production);
    mkdirSync(join(vendor, "workers"), { recursive: true });
    writeFileSync(join(source, "production_entry.py"), "class Default: pass\n");
    writeFileSync(join(vendor, "workers", "__init__.py"), "# runtime sdk\n");
    writeFileSync(join(vendor, "workers", "bridge.js"), "export default {};\n");
    writeFileSync(join(vendor, "lookup.pyc"), Buffer.from([43, 14, 13, 10]));
    writeFileSync(join(vendor, "pyvenv.cfg"), "");
    const destination = join(root, "output");
    await preparePythonOutput({
      source,
      additionalSources: [production],
      releaseTarget: "staging",
      workerRole: "api",
      entrypoint: "production_entry.py",
      durableExport: "ApiRuntime",
      vendor,
      destination,
      workerName: "atlas-api-staging",
      accountId: "a".repeat(32),
      workerEnv: { HYPERDRIVE: { type: "hyperdrive", id: "b".repeat(32) } },
    });
    const output = await readBuildOutput(destination);
    const config = output.workers.default.config;
    assert.equal(config.manifest.mainModule, "production_entry.py");
    assert.equal(config.manifest.modules["production_entry.py"].type, "python");
    assert.equal(
      config.manifest.modules["python_modules/workers/__init__.py"].type,
      "data",
    );
    assert.equal(
      config.manifest.modules["python_modules/workers/bridge.js"].type,
      "esm",
    );
    assert.equal(config.exports.ApiRuntime.storage, "sqlite");
    assert.equal(
      config.manifest.modules["python_modules/lookup.pyc"]?.type,
      "data",
    );
    assert.equal(config.workersDev, false);
    assert.ok(
      config.compatibilityFlags.includes("global_fetch_strictly_public"),
    );
    assert.equal(config.previewUrls, false);
    assert.deepEqual(config.domains ?? [], []);
    writeFileSync(
      join(source, "production_discovery.py"),
      "class Default: pass\n",
    );
    const discovery = await preparePythonOutput({
      source,
      additionalSources: [production],
      releaseTarget: "staging",
      workerRole: "discovery",
      vendor,
      destination: join(root, "discovery"),
      workerName: "atlas-discovery-staging",
      accountId: "a".repeat(32),
      workerEnv: {},
      durableExport: "DiscoveryRuntime",
      entrypoint: "production_discovery.py",
    });
    assert.equal(
      discovery.workers.default.config.manifest.mainModule,
      "production_discovery.py",
    );
    // Exercise cf's actual upload translation: Python's runtime recognizes
    // vendored packages by their canonical python_modules/ path prefix.
    const require = createRequire(import.meta.url);
    const dist = join(dirname(require.resolve("cf/package.json")), "dist");
    const adapter = readdirSync(dist).find((name) =>
      /^deploy-input-.*\.mjs$/.test(name),
    );
    const { t: uploadBundle } = await import(
      pathToFileURL(join(dist, adapter)).href
    );
    const upload = uploadBundle(output.workers.default, config);
    assert.ok(
      upload.modules.some(
        (module) => module.name === "python_modules/workers/__init__.py",
      ),
    );
    const javascript = structuredClone(config);
    javascript.manifest.modules["production_entry.py"].type = "esm";
    const jsUpload = uploadBundle(
      { ...output.workers.default, config: javascript },
      javascript,
    );
    assert.ok(
      jsUpload.modules.some(
        (module) => module.name === "./python_modules/workers/__init__.py",
      ),
    );
    symlinkSync(join(source, "production_entry.py"), join(vendor, "unsafe.py"));
    await assert.rejects(
      preparePythonOutput({
        source,
        additionalSources: [production],
        releaseTarget: "staging",
        workerRole: "api",
        entrypoint: "production_entry.py",
        durableExport: "ApiRuntime",
        vendor,
        destination,
        workerName: "atlas-api-staging",
        accountId: "a".repeat(32),
        workerEnv: {},
      }),
      /symbolic link/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build output rejects secret values and provider credentials", async () => {
  for (const workerEnv of [
    { AUTH_SECRET: { type: "secret", value: "private" } },
    { CLOUDFLARE_API_TOKEN: { type: "text", value: "private" } },
    { DATABASE_URL: { type: "text", value: "postgres://private" } },
  ])
    await assert.rejects(
      preparePythonOutput({ workerEnv }),
      /secret|credential/i,
    );
});

test("HTTP core is bundled for snapshots while deferred packages remain immutable assets", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-python-assets-"));
  try {
    const source = join(root, "source");
    const vendor = join(root, "vendor");
    mkdirSync(source);
    const production = join(root, "production");
    mkdirSync(production);
    mkdirSync(vendor);
    writeFileSync(join(source, "production_entry.py"), "class Default: pass\n");
    writeFileSync(join(vendor, "pyvenv.cfg"), "");
    writeFileSync(join(vendor, "packages.zip"), "verified archive");
    await assert.rejects(
      preparePythonOutput({
        source,
        additionalSources: [production],
        releaseTarget: "staging",
        workerRole: "api",
        entrypoint: "production_entry.py",
        durableExport: "ApiRuntime",
        vendor,
        destination: root,
        workerName: "atlas-api-staging",
        accountId: "a".repeat(32),
        workerEnv: {},
        packagesAsset: true,
      }),
      /core and deferred archives/,
    );
    writeFileSync(join(vendor, "core.zip"), "snapshot core");
    const output = await preparePythonOutput({
      source,
      additionalSources: [production],
      releaseTarget: "staging",
      workerRole: "api",
      entrypoint: "production_entry.py",
      durableExport: "ApiRuntime",
      vendor,
      destination: root,
      workerName: "atlas-api-staging",
      accountId: "a".repeat(32),
      workerEnv: {},
      packagesAsset: true,
    });
    const config = output.workers.default.config;
    assert.equal(config.env.PACKAGE_ASSETS.type, "assets");
    assert.equal(config.assets.runWorkerFirst, true);
    assert.equal(
      config.manifest.modules["python_modules/packages.zip"],
      undefined,
    );
    assert.equal(config.manifest.modules["package-identity.json"].type, "data");
    assert.equal(
      config.manifest.modules["python_modules/core.zip"].type,
      "data",
    );
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256")
      .update("verified archive")
      .digest("hex");
    assert.equal(
      JSON.parse(
        readFileSync(
          join(
            root,
            ".cloudflare/output/v0/workers/default/bundle/package-identity.json",
          ),
        ),
      ).sha256,
      expected,
    );
    assert.equal(
      JSON.parse(
        readFileSync(
          join(
            root,
            ".cloudflare/output/v0/workers/default/bundle/core-identity.json",
          ),
        ),
      ).sha256,
      createHash("sha256").update("snapshot core").digest("hex"),
    );
    assert.equal(
      readFileSync(
        join(root, ".cloudflare/output/v0/workers/default/assets/packages.zip"),
        "utf8",
      ),
      "verified archive",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production Python artifacts require exact role/target and merge helpers without collisions", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-production-output-"));
  try {
    const source = join(root, "shared"),
      production = join(root, "production"),
      vendor = join(root, "vendor");
    for (const path of [source, production, vendor]) mkdirSync(path);
    writeFileSync(join(source, "hosted_application.py"), "# shared helper\n");
    writeFileSync(
      join(production, "production_entry.py"),
      "class ApiRuntime: pass\n",
    );
    writeFileSync(
      join(production, "production_discovery.py"),
      "class DiscoveryRuntime: pass\n",
    );
    writeFileSync(join(vendor, "pyvenv.cfg"), "");
    const input = {
      source,
      additionalSources: [production],
      vendor,
      destination: join(root, "out"),
      workerName: "atlas-api-staging",
      accountId: "a".repeat(32),
      durableExport: "ApiRuntime",
      entrypoint: "production_entry.py",
      releaseTarget: "staging",
      workerRole: "api",
    };
    const output = await preparePythonOutput(input);
    assert.equal(
      output.workers.default.config.manifest.mainModule,
      "production_entry.py",
    );
    assert.equal(
      output.workers.default.config.manifest.modules["hosted_application.py"]
        .type,
      "python",
    );
    assert.equal(
      output.workers.default.config.exports.ApiRuntime.storage,
      "sqlite",
    );
    assert.deepEqual(output.workers.default.config.domains ?? [], []);
    for (const patch of [
      { workerName: "atlas-python-eval-api" },
      { workerRole: "discovery" },
      { entrypoint: "entry.py" },
      { durableExport: "Default" },
      { releaseTarget: "preview" },
    ]) {
      await assert.rejects(
        preparePythonOutput({ ...input, ...patch }),
        /production runtime/,
      );
    }
    await assert.rejects(
      preparePythonOutput({ ...input, releaseTarget: undefined }),
      /production runtime/,
    );
    writeFileSync(join(production, "hosted_application.py"), "# collision\n");
    await assert.rejects(preparePythonOutput(input), /duplicate module/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
