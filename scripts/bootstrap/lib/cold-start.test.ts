import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "./cold-start.js";

void describe("Atlas bootstrap argument parsing", () => {
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
});
