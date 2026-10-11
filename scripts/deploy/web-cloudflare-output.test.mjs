import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCloudflareOutput } from "./web-cloudflare-output.mjs";
import { applyRecoveryDomains } from "./web-rollback.mjs";
import { digestDirectory } from "./web-release.mjs";

for (const architecture of ["workers", "hybrid"]) {
  test(`cf deploy consumes the verified ${architecture} bundle and exact assets without secret values`, async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-cf-output-test-"));
    try {
      const directory = join(root, "release");
      const output = join(
        directory,
        architecture === "workers" ? "artifact" : "artifact/cf-edge",
      );
      const worker = join(output, "workers/default");
      mkdirSync(join(worker, "bundle"), { recursive: true });
      mkdirSync(join(directory, "assets"), { recursive: true });
      const source =
        "export default { fetch() { return new Response('verified SSR'); } };";
      writeFileSync(join(worker, "bundle/worker.js"), source);
      writeFileSync(
        join(directory, "assets/main-12345678.js"),
        "verified client",
      );
      writeFileSync(
        join(output, "config.json"),
        JSON.stringify({
          buildContext: {
            isPreview: false,
            ...(architecture === "workers" ? { mode: "production" } : {}),
          },
        }),
      );
      writeFileSync(
        join(worker, "worker.config.json"),
        JSON.stringify({
          name: "unpublished",
          compatibilityDate: "2026-10-10",
          manifest: {
            type: "complete",
            mainModule: "worker.js",
            modules: { "worker.js": { type: "esm" } },
          },
        }),
      );
      const parsed = await prepareCloudflareOutput({
        directory,
        architecture,
        outputRoot: join(root, "deploy"),
        accountId: "account",
        workerName: "release-worker",
        hostname: "candidate.example.com",
        workerEnv: { SIGNING_SECRET: { type: "secret" } },
      });
      assert.equal(parsed.rootConfig.accountId, "account");
      assert.equal(
        parsed.rootConfig.buildContext.mode,
        architecture === "workers" ? "production" : undefined,
      );
      assert.equal(parsed.workers.default.config.name, "release-worker");
      assert.deepEqual(parsed.workers.default.config.domains, [
        "candidate.example.com",
      ]);
      assert.equal(parsed.workers.default.config.workersDev, false);
      assert.equal(parsed.workers.default.config.previewUrls, false);
      assert.equal(
        parsed.workers.default.config.assets.htmlHandling,
        architecture === "workers" ? "drop-trailing-slash" : "none",
      );
      assert.equal(
        readFileSync(
          join(parsed.workers.default.bundleDir, "worker.js"),
          "utf8",
        ),
        source,
      );
      assert.equal(
        readFileSync(
          join(parsed.workers.default.assetsDir, "main-12345678.js"),
          "utf8",
        ),
        "verified client",
      );
      assert.deepEqual(parsed.workers.default.config.env.SIGNING_SECRET, {
        type: "secret",
      });
      assert.deepEqual(parsed.workers.default.config.env.NODE_ENV, {
        type: "text",
        value: "production",
      });
      await assert.rejects(
        prepareCloudflareOutput({
          directory,
          architecture,
          outputRoot: join(root, "invalid"),
          accountId: "account",
          workerName: "release-worker",
          hostname: "candidate.example.com",
          workerEnv: { NODE_ENV: { type: "text", value: "development" } },
        }),
        /Hosted Workers require NODE_ENV=production/,
      );
      const digest = digestDirectory(directory);
      let invoked = false;
      await applyRecoveryDomains({
        directory,
        deployment: {
          architecture,
          accountId: "account",
          workerName: "release-worker",
        },
        domains: ["candidate.example.com"],
        env: { ATLAS_CF_PROFILE: "atlas" },
        runner: (binary, args, options) => {
          invoked = true;
          assert.equal(binary, process.execPath);
          assert.deepEqual(args.slice(1, 5), [
            "workers",
            "triggers",
            "deploy",
            "--prebuilt",
          ]);
          const config = JSON.parse(
            readFileSync(
              join(
                options.cwd,
                ".cloudflare/output/v0/workers/default/worker.config.json",
              ),
              "utf8",
            ),
          );
          assert.deepEqual(config.domains, ["candidate.example.com"]);
          assert.deepEqual(config.env, {
            NODE_ENV: { type: "text", value: "production" },
            ASSETS: { type: "assets" },
          });
          assert.equal(args.includes("--secrets-file"), false);
          assert.deepEqual(args.slice(-2), ["--profile", "atlas"]);
          assert.equal(args.includes("--mode"), architecture === "workers");
          return { status: 0 };
        },
      });
      assert.equal(invoked, true);
      assert.equal(digestDirectory(directory), digest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
