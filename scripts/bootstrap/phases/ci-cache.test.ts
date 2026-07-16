import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ciCacheSecretStatusAfterMintFailure,
  formatTurboRemoteCacheDiagnostic,
  formatTurboTeamPromptMessage,
  formatVercelTokenMintFailureFollowUp,
} from "./ci-cache.js";

void describe("CI cache prompt guidance", () => {
  void it("explains how to choose the Vercel team for TURBO_TEAM", () => {
    const message = formatTurboTeamPromptMessage();

    assert.match(message, /same team that owns the Atlas Vercel project/);
    assert.match(message, /vercel teams ls/);
    assert.match(message, /GitHub Actions variable TURBO_TEAM/);
  });

  void it("keeps an existing TURBO_TOKEN usable when rotation fails", () => {
    assert.equal(ciCacheSecretStatusAfterMintFailure(true), "complete");
    assert.equal(ciCacheSecretStatusAfterMintFailure(false), "blocked");
  });

  void it("explains manual Vercel token recovery without discarding existing cache setup", () => {
    const message = formatVercelTokenMintFailureFollowUp(true);

    assert.match(message, /Existing TURBO_TOKEN was kept/);
    assert.match(message, /Create a Vercel token named atlas-ci-remote-cache/);
    assert.match(message, /gh secret set TURBO_TOKEN/);
  });

  void it("recognizes an authenticated local Turbo remote cache", () => {
    assert.match(
      formatTurboRemoteCacheDiagnostic("Remote caching enabled"),
      /authenticated and enabled locally/,
    );
  });

  void it("gives non-mutating local setup steps when Turbo is unauthenticated", () => {
    const diagnostic = formatTurboRemoteCacheDiagnostic(
      "Remote caching disabled",
    );

    assert.match(diagnostic, /pnpm turbo login/);
    assert.match(diagnostic, /pnpm turbo link/);
    assert.match(diagnostic, /does not create or rotate CI credentials/);
  });
});
