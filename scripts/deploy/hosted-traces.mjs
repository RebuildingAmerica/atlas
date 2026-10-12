#!/usr/bin/env node
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HEADER = Buffer.from("atlas-hosted-trace-v1\n");
function key(secret, identity) {
  if (
    typeof secret !== "string" ||
    secret.length < 24 ||
    !/^[a-f0-9]{40}:\d+:\d+$/.test(identity)
  )
    throw Error(
      "Existing hosted verifier secret and exact CI identity required for encrypted diagnostics.",
    );
  return hkdfSync("sha256", secret, identity, "atlas-hosted-trace-v1", 32);
}
/** Retain browser failure evidence without publishing cookies, identities or Access credentials. */
export function encryptTrace(data, secret, identity) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret, identity), iv);
  cipher.setAAD(Buffer.from(identity));
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([HEADER, iv, cipher.getAuthTag(), encrypted]);
}
export function decryptTrace(data, secret, identity) {
  if (!data.subarray(0, HEADER.length).equals(HEADER))
    throw Error("Unsupported trace encryption format.");
  const start = HEADER.length,
    decipher = createDecipheriv(
      "aes-256-gcm",
      key(secret, identity),
      data.subarray(start, start + 12),
    );
  decipher.setAAD(Buffer.from(identity));
  decipher.setAuthTag(data.subarray(start + 12, start + 28));
  return Buffer.concat([
    decipher.update(data.subarray(start + 28)),
    decipher.final(),
  ]);
}

/** Decode the retained report only in the existing credentialed doctor process. */
export function readRetainedHostedReport({ directory, secret, identity }) {
  const index = JSON.parse(readFileSync(join(directory, "index.json"), "utf8"));
  const name = "hosted-results.json.encrypted";
  if (index.identity !== identity || !index.files?.includes(name))
    throw Error("Retained hosted report identity differs.");
  return JSON.parse(
    decryptTrace(
      readFileSync(join(directory, name)),
      secret,
      identity,
    ).toString("utf8"),
  );
}
export function retainHostedTraces({ source, destination, secret, identity }) {
  if (!existsSync(source)) return { status: "no-traces", files: 0 };
  const files = [];
  function walk(path, relative = "") {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw Error("Hosted diagnostics cannot follow symbolic links.");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path))
        walk(join(path, name), join(relative, name));
      return;
    }
    if (!stat.isFile()) throw Error("Unsupported hosted diagnostic file.");
    const output = join(destination, `${relative}.encrypted`);
    mkdirSync(resolve(output, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(output, encryptTrace(readFileSync(path), secret, identity), {
      mode: 0o600,
    });
    files.push(`${relative}.encrypted`);
  }
  walk(source);
  if (files.length)
    writeFileSync(
      join(destination, "index.json"),
      JSON.stringify({ schemaVersion: 1, identity, files }) + "\n",
      { mode: 0o600 },
    );
  return { status: "encrypted", files: files.length };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    console.log(
      JSON.stringify(
        retainHostedTraces({
          source: resolve("app/test-results"),
          destination: resolve(".atlas/cloudflare-release/hosted-traces"),
          secret: process.env.ATLAS_HOSTED_E2E_SECRET,
          identity: `${process.env.GITHUB_SHA}:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}`,
        }),
      ),
    );
  } catch {
    console.error(
      "Hosted trace retention failed; no unencrypted diagnostics were uploaded.",
    );
    process.exitCode = 1;
  }
}
