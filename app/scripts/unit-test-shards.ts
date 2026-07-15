#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ALL_UNIT_TEST_SHARDS = [
  "access",
  "business",
  "catalog",
  "platform",
  "workspace",
  "system",
] as const;

export type UnitTestShard = (typeof ALL_UNIT_TEST_SHARDS)[number];

const UNIT_TEST_SHARDS: Record<UnitTestShard, string[]> = {
  access: [
    "tests/unit/domains/access",
    "tests/unit/playwright-atproto-env.test.ts",
    "tests/unit/routes/_auth",
    "tests/unit/routes/_auth.test.tsx",
    "tests/unit/routes/api/atproto",
    "tests/unit/routes/api/auth",
  ],
  business: [
    "tests/unit/domains/admin",
    "tests/unit/domains/billing",
    "tests/unit/routes/api/stripe",
  ],
  catalog: [
    "tests/unit/domains/catalog",
    "tests/unit/domains/discovery",
    "tests/unit/domains/firehose",
    "tests/unit/routes/_public",
    "tests/unit/routes/_public.test.tsx",
    "tests/unit/routes/firehose-rss.test.ts",
    "tests/unit/routes/public-home-page.test.tsx",
  ],
  platform: [
    "tests/unit/components",
    "tests/unit/entry.client.test.tsx",
    "tests/unit/entry.server.test.ts",
    "tests/unit/lib",
    "tests/unit/platform",
    "tests/unit/router.test.tsx",
    "tests/unit/routes/__root.test.tsx",
    "tests/unit/turbo-config.test.ts",
    "tests/unit/vite-config-route-rules.test.ts",
  ],
  workspace: [
    "tests/unit/domains/onboarding",
    "tests/unit/domains/workspace",
    "tests/unit/routes/_onboarding",
    "tests/unit/routes/_workspace",
    "tests/unit/routes/_workspace-test-support.tsx",
    "tests/unit/routes/_workspace.actions.test.tsx",
    "tests/unit/routes/_workspace.before-load.test.tsx",
    "tests/unit/routes/_workspace.identity.test.tsx",
    "tests/unit/routes/_workspace.layout.test.tsx",
    "tests/unit/routes/dashboard.test.tsx",
  ],
  system: [
    "tests/unit/acceptance",
    "tests/unit/routes/[.]well-known",
    "tests/unit/routes/api/$.test.ts",
    "tests/unit/routes/api/health.test.ts",
    "tests/unit/routes/device",
    "tests/unit/routes/docs",
    "tests/unit/routes/docs.test.ts",
    "tests/unit/routes/health.test.ts",
    "tests/unit/routes/llms-txt.test.ts",
    "tests/unit/routes/openapi-json.test.ts",
    "tests/unit/routes/robots-txt.test.ts",
    "tests/unit/routes/sitemap-xml.test.ts",
    "tests/unit/scripts",
  ],
};

export function unitTestShardPaths(shard: UnitTestShard | "all"): string[] {
  if (shard === "all") {
    return ALL_UNIT_TEST_SHARDS.flatMap((name) => unitTestShardPaths(name));
  }

  return UNIT_TEST_SHARDS[shard];
}

function isUnitTestShard(value: string): value is UnitTestShard | "all" {
  return value === "all" || ALL_UNIT_TEST_SHARDS.some((shard) => shard === value);
}

function main(): never {
  const shard = process.argv[2];

  if (!shard || !isUnitTestShard(shard)) {
    throw new Error(
      `Usage: tsx scripts/unit-test-shards.ts <${ALL_UNIT_TEST_SHARDS.join("|")}|all>`,
    );
  }

  const result = spawnSync("pnpm", ["exec", "vitest", "run", ...unitTestShardPaths(shard)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
