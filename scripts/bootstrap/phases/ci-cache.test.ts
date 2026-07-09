import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTurboTeamPromptMessage } from "./ci-cache.js";

void describe("CI cache prompt guidance", () => {
  void it("explains how to choose the Vercel team for TURBO_TEAM", () => {
    const message = formatTurboTeamPromptMessage();

    assert.match(message, /same team that owns the Atlas Vercel project/);
    assert.match(message, /vercel teams ls/);
    assert.match(message, /GitHub Actions variable TURBO_TEAM/);
  });
});
