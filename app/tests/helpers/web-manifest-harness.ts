import { readFileSync } from "node:fs";

interface ManifestIcon {
  purpose: string;
  sizes: string;
  src: string;
}

interface WebManifest {
  background_color: string;
  icons: ManifestIcon[];
  name: string;
  short_name: string;
  theme_color: string;
}

// jsdom test files see an http import.meta.url, so resolve from the app root,
// which is where vitest runs.
const PUBLIC_DIR = `${process.cwd()}/public`;

export function loadWebManifest(): WebManifest {
  return JSON.parse(readFileSync(`${PUBLIC_DIR}/site.webmanifest`, "utf8")) as WebManifest;
}

/** Reads a public PNG's dimensions from its IHDR chunk as "WIDTHxHEIGHT". */
export function readPublicPngSize(publicPath: string): string {
  const png = readFileSync(`${PUBLIC_DIR}${publicPath}`);
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}
