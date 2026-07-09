import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatToolSummary, formatToolVersion } from "./install.js";

void describe("bootstrap tool summary", () => {
  void it("summarizes system tools in one block", () => {
    assert.equal(
      formatToolSummary([
        { label: "Node.js", version: "v24.18.0" },
        { label: "pnpm", version: "11.10.0" },
        { label: "GitHub CLI", version: "gh version 2.94.0 (2026-06-10)" },
        { label: "uv" },
      ]),
      [
        "4 tools ready",
        "",
        "Node.js: 24.18.0",
        "pnpm: 11.10.0",
        "GitHub CLI: 2.94.0",
        "uv: installed",
      ].join("\n"),
    );
  });

  void it("normalizes verbose CLI version output", () => {
    assert.equal(
      formatToolVersion(
        [
          "1.7.12",
          "installed by building from source",
          "built with go1.26.1 compiler for darwin/arm64",
        ].join("\n"),
      ),
      "1.7.12",
    );
    assert.equal(formatToolVersion("gh version 2.94.0 (2026-06-10)"), "2.94.0");
    assert.equal(formatToolVersion(undefined), "installed");
  });
});
