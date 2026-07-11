import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runHealthProbe } from "./api-edge-health.js";

void describe("API edge health probe", () => {
  void it("uses GET so GET-only /health routes are accepted", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "atlas-health-probe-"));
    const commandPath = path.join(tmp, "command.txt");
    const shellPath = path.join(tmp, "shell");
    const previousShell = process.env.SHELL;
    writeFileSync(
      shellPath,
      [
        "#!/bin/sh",
        `printf '%s' "$2" > ${JSON.stringify(commandPath)}`,
        'case "$2" in',
        '  *" -I "*|*" -sI "*)',
        "    printf 'HTTP/2 405\\r\\nallow: GET\\r\\n\\r\\n'",
        "    exit 22",
        "    ;;",
        "esac",
        "printf 'HTTP/2 200\\r\\nserver: cloudflare\\r\\ncf-ray: test\\r\\n\\r\\n'",
      ].join("\n"),
      { mode: 0o700 },
    );

    try {
      process.env.SHELL = shellPath;

      const probe = runHealthProbe("atlas-api.rebuildingus.org");

      assert.equal(probe.healthy, true);
      assert.equal(probe.statusCode, 200);
      assert.equal(probe.viaCloudflare, true);
      const command = readFileSync(commandPath, "utf8");
      assert.match(command, /-D - -o \/dev\/null/);
      assert.doesNotMatch(command, /(?:^|\s)-I(?:\s|$)/);
      assert.doesNotMatch(command, /(?:^|\s)-sI(?:\s|$)/);
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
