import { describe, expect, it } from "vitest";
import { ALL_UNIT_TEST_SHARDS, unitTestShardPaths } from "../../../scripts/unit-test-shards";
import { collectUnitTestFiles, pathContainsTestFile } from "../../helpers/unit-test-shard-harness";

describe("unit test shards", () => {
  it("assign every unit test file to a cacheable shard", () => {
    const assignedPaths = ALL_UNIT_TEST_SHARDS.flatMap((shard) => unitTestShardPaths(shard));
    const testFiles = collectUnitTestFiles();

    expect(testFiles).not.toHaveLength(0);
    expect(
      testFiles.filter(
        (testFile) => !assignedPaths.some((shardPath) => pathContainsTestFile(shardPath, testFile)),
      ),
    ).toEqual([]);
  });
});
