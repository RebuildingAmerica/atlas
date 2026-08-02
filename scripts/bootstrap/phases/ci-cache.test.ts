import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCiCacheStatus,
  formatTurboRemoteCacheDiagnostic,
} from "./ci-cache.js";

void describe("CI cache guidance", () => {
  void it("describes the turnkey GitHub Actions cache without provider authentication", () => {
    const status = formatCiCacheStatus();

    assert.match(status, /GitHub Actions cache/);
    assert.match(status, /needs no Vercel login or token/);
  });

  void it("recognizes an optional authenticated local Turbo remote cache", () => {
    assert.match(
      formatTurboRemoteCacheDiagnostic("Remote caching enabled"),
      /authenticated and enabled/,
    );
  });

  void it("keeps local and CI caches usable without remote authentication", () => {
    const diagnostic = formatTurboRemoteCacheDiagnostic(
      "Remote caching disabled",
    );

    assert.match(diagnostic, /Local builds still use \.turbo\/cache/);
    assert.match(diagnostic, /GitHub Actions cache automatically/);
    assert.doesNotMatch(diagnostic, /login|token/i);
  });
});
