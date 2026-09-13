import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "./lib/cold-start.js";
import type { BootstrapRun } from "./run-context.js";
import { selectSingleMode } from "./single-mode.js";
import type { ReadinessState } from "./state.js";

function runFor(argv: string[]): BootstrapRun {
  const state: ReadinessState = {
    version: 1,
    generatedAt: "2026-09-13T00:00:00.000Z",
    capabilities: {},
    commandReadiness: {} as ReadinessState["commandReadiness"],
    phases: {},
  };
  return {
    projectRoot: "/tmp/atlas",
    args: parseArgs(argv),
    state,
    allFollowUp: [],
    attemptedPhases: new Set(),
  };
}

void describe("single-phase bootstrap modes", () => {
  void it("selects nothing for a full bootstrap run", () => {
    assert.equal(selectSingleMode(runFor([])), null);
  });

  void it("gives infrastructure precedence when several single-phase flags are passed", () => {
    const mode = selectSingleMode(runFor(["--infra", "--mcp-registry"]));
    assert.equal(mode?.phaseLabel, "Cloud Infrastructure");
    assert.equal(
      mode.announcement,
      "Running cloud infrastructure setup only (target=production).",
    );
  });

  void it("records a doctor-mode infrastructure failure as partial, not failed", () => {
    const run = runFor(["--infra", "--doctor", "--target", "staging"]);
    const mode = selectSingleMode(run);
    assert.ok(mode);
    mode.record({ success: false, followUpItems: [] });
    assert.equal(run.state.targetPhases?.["infra:staging"]?.status, "partial");
  });

  void it("records a phase's own status when it reports one", () => {
    const run = runFor(["--mcp-registry"]);
    const mode = selectSingleMode(run);
    assert.ok(mode);
    mode.record({ success: true, followUpItems: [], status: "waiting" });
    assert.equal(run.state.phases["mcp-registry"]?.status, "waiting");
    assert.equal(mode.successMessage, "MCP Registry publisher setup complete.");
  });

  void it("treats an unreported status as partial for the reporting modes", () => {
    const run = runFor(["--ci-cache"]);
    const mode = selectSingleMode(run);
    assert.ok(mode);
    mode.record({ success: false, followUpItems: [] });
    assert.equal(run.state.phases["ci-cache"]?.status, "partial");
    assert.equal(mode.failureMessage, "CI cache wiring had issues.");
  });

  void it("records API domain and edge results against the hosted target", () => {
    const domain = runFor(["--api-domain", "--target", "prod"]);
    const domainMode = selectSingleMode(domain);
    assert.ok(domainMode);
    domainMode.record({ success: true, followUpItems: [] });
    assert.equal(
      domain.state.targetPhases?.["api-domain:production"]?.status,
      "complete",
    );

    const edge = runFor(["--api-edge", "--target", "staging"]);
    const edgeMode = selectSingleMode(edge);
    assert.ok(edgeMode);
    edgeMode.record({ success: true, followUpItems: [] });
    assert.equal(
      edge.state.targetPhases?.["api-edge:staging"]?.status,
      "complete",
    );
  });

  void it("records a failed product sync outside doctor mode as failed", () => {
    const run = runFor(["--product", "atlas"]);
    const mode = selectSingleMode(run);
    assert.ok(mode);
    mode.record({ success: false, followUpItems: [] });
    assert.equal(run.state.phases.product?.status, "failed");
    assert.equal(mode.failureMessage, "Stripe setup pending.");
  });
});
