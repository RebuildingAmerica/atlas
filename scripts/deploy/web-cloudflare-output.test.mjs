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
      assert.equal(parsed.workers.default.config.assets.htmlHandling, "none");
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
