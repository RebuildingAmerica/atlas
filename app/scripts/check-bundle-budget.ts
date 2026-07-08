import { readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KIB = 1024;
const MIB = KIB * KIB;
const ASSETS_DIR = fileURLToPath(new URL("../.output/public/assets", import.meta.url));
const TOTAL_PUBLIC_ASSET_BUDGET_BYTES = 3.5 * MIB;

interface AssetSize {
  bytes: number;
  name: string;
}

interface ChunkBudget {
  label: string;
  maxBytes: number;
  pattern: RegExp;
}

const CHUNK_BUDGETS: ChunkBudget[] = [
  {
    label: "main public JS",
    maxBytes: 850 * KIB,
    pattern: /^(?:index|main)-[\w-]+\.js$/,
  },
  {
    label: "browse route JS",
    maxBytes: 180 * KIB,
    pattern: /^browse-[\w-]+\.js$/,
  },
  {
    label: "map route JS",
    maxBytes: 80 * KIB,
    pattern: /^map(?:-[\w-]+)?-[\w-]+\.js$/,
  },
  {
    label: "profile route JS",
    maxBytes: 90 * KIB,
    pattern:
      /^(?:people|organizations)(?:\.index|\._slug)?-[\w-]+\.js$|^profiles-overview-page-[\w-]+\.js$/,
  },
  {
    label: "MapLibre main JS",
    maxBytes: 1.2 * MIB,
    pattern: /^maplibre-gl-(?!csp-worker-)[\w-]+\.js$/,
  },
  {
    label: "MapLibre worker JS",
    maxBytes: 520 * KIB,
    pattern: /^maplibre-gl-csp-worker-[\w-]+\.js$/,
  },
];

async function readAssets(directory: string): Promise<AssetSize[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const assets = await Promise.all(
    entries.map(async (entry): Promise<AssetSize[]> => {
      const path = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        return await readAssets(path);
      }

      if (!entry.isFile()) {
        return [];
      }

      const details = await stat(path);
      return [{ bytes: details.size, name: basename(path) }];
    }),
  );

  return assets.flat();
}

function formatBytes(bytes: number): string {
  if (bytes >= MIB) {
    return `${(bytes / MIB).toFixed(2)} MiB`;
  }
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

function formatAssetList(assets: AssetSize[]): string {
  if (assets.length === 0) {
    return "missing";
  }

  if (assets.length > 5) {
    return `${assets.length.toString()} assets`;
  }

  return assets.map((asset) => asset.name).join(", ");
}

async function main(): Promise<void> {
  const assets = await readAssets(ASSETS_DIR);
  const passed: string[] = [];
  const failed: string[] = [];

  for (const budget of CHUNK_BUDGETS) {
    const matchingAssets = assets.filter((asset) => budget.pattern.test(asset.name));
    const bytes = matchingAssets.reduce((total, asset) => total + asset.bytes, 0);
    const result = `${budget.label}: ${formatBytes(bytes)} / ${formatBytes(
      budget.maxBytes,
    )} (${formatAssetList(matchingAssets)})`;

    if (matchingAssets.length === 0 || bytes > budget.maxBytes) {
      failed.push(result);
    } else {
      passed.push(result);
    }
  }

  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  const totalResult = `total public assets: ${formatBytes(totalBytes)} / ${formatBytes(
    TOTAL_PUBLIC_ASSET_BUDGET_BYTES,
  )} (${assets.length.toString()} assets)`;

  if (totalBytes > TOTAL_PUBLIC_ASSET_BUDGET_BYTES) {
    failed.push(totalResult);
  } else {
    passed.push(totalResult);
  }

  if (failed.length > 0) {
    console.error(["Bundle budget failed:", ...failed.map((result) => `- ${result}`)].join("\n"));
    process.exitCode = 1;
    return;
  }

  console.warn(["Bundle budget passed:", ...passed.map((result) => `- ${result}`)].join("\n"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
