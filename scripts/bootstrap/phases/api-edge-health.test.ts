import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseDomainMappingReadiness,
  preflightCanonicalDomain,
  runHealthProbe,
} from "./api-edge-health.js";
import type { ApiEdgeConfig } from "./api-edge-models.js";

interface StubShell {
  commands: () => string;
}

const EDGE_CONFIG: ApiEdgeConfig = {
  target: "prod",
  domain: "atlas-api.rebuildingus.org",
  service: "atlas-api",
  region: "us-central1",
  project: "rap-atlas-prod",
  edgeOriginSecret: "test-secret",
};

/**
 * Run a block against a scripted stand-in for $SHELL.
 *
 * Parameters
 * ----------
 * body
 *     Shell script body receiving the executed command as "$2".
 * assertions
 *     Block run with the stub installed; receives the recorded command log.
 *
 * Returns
 * -------
 * void
 *     Nothing; the stub and its temporary directory are always torn down.
 */
function withStubShell(
  body: string[],
  assertions: (shell: StubShell) => void,
): void {
  const tmp = mkdtempSync(path.join(tmpdir(), "atlas-edge-health-"));
  const commandLog = path.join(tmp, "commands.txt");
  const shellPath = path.join(tmp, "shell");
  writeFileSync(
    shellPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$2" >> ${JSON.stringify(commandLog)}`,
      ...body,
    ].join("\n"),
    { mode: 0o700 },
  );
  writeFileSync(commandLog, "", "utf8");

  const previousShell = process.env.SHELL;
  try {
    process.env.SHELL = shellPath;
    assertions({ commands: () => readFileSync(commandLog, "utf8") });
  } finally {
    if (previousShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = previousShell;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

void describe("API edge health probe", () => {
  void it("uses GET so GET-only /health routes are accepted", () => {
    withStubShell(
      [
        'case "$2" in',
        '  *" -I "*|*" -sI "*)',
        "    printf 'HTTP/2 405\\r\\nallow: GET\\r\\n\\r\\n'",
        "    exit 22",
        "    ;;",
        "esac",
        "printf 'HTTP/2 200\\r\\nserver: cloudflare\\r\\ncf-ray: test\\r\\n\\r\\n'",
      ],
      (shell) => {
        const probe = runHealthProbe("atlas-api.rebuildingus.org");

        assert.equal(probe.healthy, true);
        assert.equal(probe.statusCode, 200);
        assert.equal(probe.viaCloudflare, true);
        const command = shell.commands();
        assert.match(command, /-D - -o \/dev\/null/);
        assert.doesNotMatch(command, /(?:^|\s)-I(?:\s|$)/);
        assert.doesNotMatch(command, /(?:^|\s)-sI(?:\s|$)/);
      },
    );
  });
});

void describe("canonical domain preflight", () => {
  void it("accepts a serving API without consulting the domain mapping", () => {
    // Regression: a healthy API was blocked from edge setup because an
    // unrelated gcloud failure made the domain mapping unreadable.
    withStubShell(
      [
        'case "$2" in',
        "  *gcloud*)",
        "    echo 'ERROR: Reauthentication failed.' 1>&2",
        "    exit 1",
        "    ;;",
        "esac",
        "printf 'HTTP/2 200\\r\\nserver: cloudflare\\r\\ncf-ray: test\\r\\n\\r\\n'",
      ],
      (shell) => {
        const probe = preflightCanonicalDomain(EDGE_CONFIG);

        assert.equal(probe.healthy, true);
        assert.equal(probe.statusCode, 200);
        assert.doesNotMatch(shell.commands(), /gcloud/);
      },
    );
  });

  void it("explains a failing probe with the domain mapping status", () => {
    withStubShell(
      [
        'case "$2" in',
        "  *gcloud*)",
        "    cat <<'JSON'",
        JSON.stringify({
          status: {
            conditions: [
              { type: "CertificateProvisioned", status: "False" },
              {
                type: "Ready",
                status: "False",
                reason: "CertificatePending",
                message: "Waiting for certificate provisioning.",
              },
            ],
          },
        }),
        "JSON",
        "    exit 0",
        "    ;;",
        "esac",
        "printf 'HTTP/2 503\\r\\n\\r\\n'",
      ],
      (shell) => {
        const probe = preflightCanonicalDomain(EDGE_CONFIG);

        assert.equal(probe.healthy, false);
        assert.equal(probe.statusCode, 503);
        assert.match(probe.output, /HTTP\/2 503/);
        assert.match(probe.output, /not Ready \(status False\)/);
        assert.match(probe.output, /CertificatePending/);
        const commands = shell.commands();
        assert.match(commands, /domain-mappings describe/);
        assert.doesNotMatch(commands, /2>\/dev\/null/);
      },
    );
  });
});

void describe("domain mapping readiness", () => {
  void it("surfaces the gcloud error instead of swallowing stderr", () => {
    const readiness = parseDomainMappingReadiness({
      ok: false,
      stdout: "",
      stderr:
        "ERROR: (gcloud.beta.run.domain-mappings.describe) There was a problem refreshing your current auth tokens: Reauthentication failed.",
    });

    assert.equal(readiness.queried, false);
    assert.equal(readiness.ready, false);
    assert.match(readiness.detail, /Reauthentication failed/);
  });

  void it("reads the Ready condition rather than the first condition", () => {
    const readiness = parseDomainMappingReadiness({
      ok: true,
      stdout: JSON.stringify({
        status: {
          conditions: [
            { type: "CertificateProvisioned", status: "False" },
            { type: "Ready", status: "True" },
          ],
        },
      }),
      stderr: "",
    });

    assert.equal(readiness.queried, true);
    assert.equal(readiness.ready, true);
    assert.match(readiness.detail, /Ready/);
  });

  void it("reports a mapping that has not published conditions yet", () => {
    const readiness = parseDomainMappingReadiness({
      ok: true,
      stdout: JSON.stringify({ status: {} }),
      stderr: "",
    });

    assert.equal(readiness.queried, true);
    assert.equal(readiness.ready, false);
    assert.match(readiness.detail, /has not reported a Ready condition/);
  });

  void it("reports unreadable describe output", () => {
    const readiness = parseDomainMappingReadiness({
      ok: true,
      stdout: "not json",
      stderr: "",
    });

    assert.equal(readiness.queried, false);
    assert.equal(readiness.ready, false);
    assert.match(readiness.detail, /unreadable output/);
    assert.match(readiness.detail, /not json/);
  });
});
