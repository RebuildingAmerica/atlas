import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  bootstrapOutroMessage,
  describePhase,
  formatFollowUpNote,
  parseArgs,
  phaseEntriesForSummary,
  recomputeCommandReadiness,
  shouldStopAfterAuthFailure,
} from "./cold-start.js";
import { renderSetupGuide } from "../config/setup-manifest.js";
import type { PhaseId, ReadinessState } from "../state.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

void describe("Atlas bootstrap argument parsing", () => {
  void it("runs exhaustive production setup by default", () => {
    const args = parseArgs([]);

    assert.equal(args.localOnly, false);
    assert.equal(args.stripeTarget, "prod");
    assert.equal(args.live, true);
  });

  void it("keeps local setup behind an explicit local-only flag", () => {
    const args = parseArgs(["--local-only"]);

    assert.equal(args.localOnly, true);
    assert.equal(args.stripeTarget, "local");
    assert.equal(args.live, false);
  });

  void it("keeps the default package setup command exhaustive", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve("package.json"), "utf8"),
    ) as PackageJson;

    assert.equal(
      packageJson.scripts?.setup,
      "tsx scripts/bootstrap/cold-start.ts",
    );
    assert.equal(
      packageJson.scripts?.["setup:local"],
      "tsx scripts/bootstrap/cold-start.ts --local-only",
    );
  });

  void it("runs hosted setup only for an explicit hosted target", () => {
    const staging = parseArgs(["--target", "staging"]);
    const prod = parseArgs(["--target", "prod", "--live"]);

    assert.equal(staging.localOnly, false);
    assert.equal(staging.stripeTarget, "staging");
    assert.equal(prod.localOnly, false);
    assert.equal(prod.stripeTarget, "prod");
    assert.equal(prod.live, true);
  });

  void it("supports noninteractive confirmation for hosted product sync", () => {
    const args = parseArgs([
      "--product",
      "atlas",
      "--target",
      "staging",
      "--yes",
    ]);

    assert.equal(args.assumeYes, true);
    assert.equal(args.productOnly, "atlas");
    assert.equal(args.stripeTarget, "staging");
  });

  void it("keeps product-only sync local unless a hosted target is explicit", () => {
    const args = parseArgs(["--product", "atlas"]);

    assert.equal(args.productOnly, "atlas");
    assert.equal(args.localOnly, false);
    assert.equal(args.stripeTarget, "local");
    assert.equal(args.live, false);
  });

  void it("stops setup after auth fails outside doctor mode", () => {
    assert.equal(shouldStopAfterAuthFailure(false, false), true);
    assert.equal(shouldStopAfterAuthFailure(false, true), false);
    assert.equal(shouldStopAfterAuthFailure(true, false), false);
  });

  void it("describes what a phase is about before it runs", () => {
    assert.match(describePhase("Environment Configuration"), /env files/);
    assert.match(describePhase("Stripe Products"), /products, prices/);
  });

  void it("keeps setup instructions inside bootstrap instead of pointing to doctor first", () => {
    const guide = renderSetupGuide("prod");

    assert.match(guide, /Target: Production/);
    assert.match(guide, /Confirm CLI accounts/);
    assert.doesNotMatch(guide, /Inspect first/);
    assert.doesNotMatch(guide, /--doctor/);
  });

  void it("keeps the opening setup guide scannable", () => {
    const guide = renderSetupGuide("prod");

    assert.ok(guide.split("\n").length <= 8);
    assert.doesNotMatch(guide, /https:\/\/console\.anthropic\.com/);
    assert.doesNotMatch(guide, /STRIPE_API_KEY/);
    assert.doesNotMatch(guide, /writes to/i);
  });

  void it("summarizes only phases attempted in the current run", () => {
    const state: ReadinessState = {
      version: 1,
      generatedAt: "2026-07-09T00:00:00.000Z",
      capabilities: {},
      commandReadiness: {
        build: "ready",
        deploy: "ready",
        dev: "ready",
        product: "ready",
        test: "ready",
      },
      phases: {
        env: {
          completedAt: "2026-07-09T00:00:00.000Z",
          status: "complete",
        },
        infra: {
          completedAt: "2026-07-08T00:00:00.000Z",
          status: "failed",
        },
        product: {
          completedAt: "2026-07-09T00:00:00.000Z",
          status: "complete",
        },
      },
    };

    assert.deepEqual(
      phaseEntriesForSummary(state, new Set<PhaseId>(["env", "product"])).map(
        ([phase]) => phase,
      ),
      ["env", "product"],
    );
  });

  void it("marks deploy command readiness blocked after a blocked deploy phase", () => {
    const state: ReadinessState = {
      version: 1,
      generatedAt: "2026-07-09T00:00:00.000Z",
      capabilities: {},
      commandReadiness: {
        build: "ready",
        deploy: "ready",
        dev: "ready",
        product: "ready",
        test: "ready",
      },
      phases: {
        deploy: {
          completedAt: "2026-07-09T00:00:00.000Z",
          status: "blocked",
        },
      },
    };

    recomputeCommandReadiness(state);

    assert.equal(state.commandReadiness.deploy, "blocked");
  });

  void it("groups follow-up items by urgency instead of dumping a flat list", () => {
    const note = formatFollowUpNote([
      "In Mintlify, enable 'Host at /docs' for the Atlas domain.",
      "Stripe live mode requires a sk_live_ or rk_live_ API key.",
      "Cert provisioning still in progress for atlas-api.rebuildingus.org.",
      "Start Docker Desktop, wait for `docker info`, then run `pnpm bootstrap --resume`.",
    ]);

    assert.match(note, /Blocking/);
    assert.match(note, /Waiting/);
    assert.match(note, /Optional/);
    assert.ok(note.indexOf("Blocking") < note.indexOf("Waiting"));
    assert.ok(note.indexOf("Waiting") < note.indexOf("Optional"));
  });

  void it("does not call bootstrap complete when follow-ups remain", () => {
    assert.equal(
      bootstrapOutroMessage({ doctorMode: false, hasFollowUps: true }),
      "Atlas bootstrap finished with follow-ups.",
    );
    assert.equal(
      bootstrapOutroMessage({ doctorMode: false, hasFollowUps: false }),
      "Atlas bootstrap ready.",
    );
  });
});
