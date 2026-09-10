import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CaptureResult } from "./manifest-types";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = resolve(appDir, "..");

/** Root of the generated audit. Overridable so a run can be kept aside for sharing. */
export const OUTPUT_DIR = process.env.ATLAS_SCREENSHOTS_OUT_DIR
  ? resolve(process.env.ATLAS_SCREENSHOTS_OUT_DIR)
  : resolve(repoRoot, "screenshots");

export const IMAGE_DIR = resolve(OUTPUT_DIR, "desktop-light");
export const RESULT_DIR = resolve(IMAGE_DIR, "_results");

/**
 * Where the signed-in cookies are parked for the session pass to reuse.
 *
 * This lives here rather than beside the setup test because the Playwright config needs it,
 * and importing the setup module from the config would evaluate the sign-in helpers before
 * the config has had a chance to set the environment they require.
 */
export const STORAGE_STATE = "node_modules/.cache/screenshots/session-state.json";

/**
 * Writes one capture's sidecar next to its PNG.
 *
 * Each capture writes independently so a crashed run still leaves a partial, readable report.
 *
 * @param result - The outcome of a single page capture.
 */
export async function writeCaptureResult(result: CaptureResult): Promise<void> {
  await mkdir(RESULT_DIR, { recursive: true });
  await writeFile(
    resolve(RESULT_DIR, `${result.name}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Absolute path of the PNG for a capture.
 *
 * @param name - The manifest entry's unique name.
 */
export function imagePath(name: string): string {
  return resolve(IMAGE_DIR, `${name}.png`);
}
