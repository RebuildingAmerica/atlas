import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAssetHeaders } from "../../app/scripts/asset-headers.mjs";

test("generated cache policy distinguishes immutable chunks from stable public files", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-assets-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "assets"));
  for (const file of [
    "assets/page-Abc12345.js",
    "assets/theme-Abc12345.css",
    "robots.txt",
    "favicon.ico",
  ])
    writeFileSync(join(directory, file), "content");
  writeAssetHeaders(directory);
  const headers = readFileSync(join(directory, "_headers"), "utf8");
  assert.match(headers, /\/\*\n  Cache-Control: public, max-age=300/);
  assert.match(
    headers,
    /\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.doesNotMatch(headers, /\/robots.txt\n  Cache-Control:.*immutable/);
});

test("mixed asset directories do not make stable filenames immutable", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-mixed-assets-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "assets/stable.js"), "stable");
  writeFileSync(join(directory, "assets/page-Abc12345.js"), "hashed");
  writeAssetHeaders(directory);
  const headers = readFileSync(join(directory, "_headers"), "utf8");
  assert.match(
    headers,
    /\/assets\/page-Abc12345.js\n  Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.doesNotMatch(headers, /\/assets\/\*/);
});
