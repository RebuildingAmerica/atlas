#!/usr/bin/env node
// Generate the full favicon set for the docs site from a single source SVG.
// Output is committed under mintlify/favicons/ so Mintlify's hosted build picks
// it up directly from git — Mintlify does not run scripts at deploy time.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { favicons } from "favicons";

const HERE = dirname(fileURLToPath(import.meta.url));
const MINTLIFY_ROOT = resolve(HERE, "..");
const SOURCE = join(MINTLIFY_ROOT, "brand", "atlas.svg");
const OUT_DIR = join(MINTLIFY_ROOT, "favicons");

const CONFIGURATION = {
  path: "/favicons",
  appName: "Atlas Docs",
  appShortName: "Atlas",
  appDescription:
    "Atlas — open-source civic actor discovery platform documentation.",
  background: "#ffffff",
  theme_color: "#c2956a",
  icons: {
    android: true,
    appleIcon: true,
    appleStartup: false,
    favicons: true,
    windows: true,
    yandex: false,
  },
};

if (!existsSync(SOURCE)) {
  console.error(`[favicons] source not found: ${SOURCE}`);
  process.exit(1);
}

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const response = await favicons(SOURCE, CONFIGURATION);

await Promise.all([
  ...response.images.map((image) =>
    writeFile(join(OUT_DIR, image.name), image.contents),
  ),
  ...response.files.map((file) =>
    writeFile(join(OUT_DIR, file.name), file.contents),
  ),
]);

console.log(
  `[favicons] wrote ${response.images.length + response.files.length} files to ${OUT_DIR}`,
);
