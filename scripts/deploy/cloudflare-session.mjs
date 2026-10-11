import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "../..");
const SESSION = Symbol("cloudflare-session");
const PROFILE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const validToken = (token) => typeof token === "string" && /^\S+$/.test(token);
let credentialLoading = false;

/** Private, version-pinned bridge: never call the CLI's refreshing token getter. */
export async function loadPinnedOAuthCredential(
  profile,
  {
    resolvePackage = () => require.resolve("cf/package.json"),
    readPackage = (file) => JSON.parse(readFileSync(file, "utf8")),
    importModule = (url) => import(url),
  } = {},
) {
  if (!PROFILE.test(profile ?? "") || credentialLoading)
    throw new Error(
      "A valid profile and exclusive credential loading are required.",
    );
  credentialLoading = true;
  const methods = ["log", "info", "warn", "error", "debug"];
  const originals = new Map(methods.map((method) => [method, console[method]]));
  try {
    // This isolated session entrypoint has no concurrent work during loading.
    // cf's storage logger forwards to console, including credential diagnostics.
    for (const method of methods) console[method] = () => {};
    const file = resolvePackage();
    const pkg = readPackage(file);
    if (pkg.name !== "cf" || pkg.version !== "1.0.0-beta.14") throw new Error();
    const auth = await importModule(
      pathToFileURL(join(dirname(file), "dist/oauth-BUr8bPwo.mjs")).href,
    );
    if (
      typeof auth.p !== "function" ||
      typeof auth.d !== "function" ||
      typeof auth.s !== "function"
    )
      throw new Error();
    auth.p(profile);
    return await auth.d();
  } catch {
    throw new Error(
      "The pinned cf credential loader is unavailable; no child was started.",
    );
  } finally {
    for (const [method, original] of originals) console[method] = original;
    credentialLoading = false;
  }
}

/** Read once; retain only the bearer and expiry, never refresh or persist it. */
export async function createCloudflareSession({
  env = process.env,
  profile,
  accountId,
  loader = loadPinnedOAuthCredential,
  now = Date.now,
} = {}) {
  if (profile !== undefined && !PROFILE.test(profile))
    throw new Error("An explicit valid ATLAS_CF_PROFILE is required.");
  if (accountId !== undefined && !/^[a-fA-F0-9]{32}$/.test(accountId))
    throw new Error(
      "An explicit Cloudflare account ID must contain 32 hexadecimal characters.",
    );
  env = {
    ...env,
    ...(profile === undefined ? {} : { ATLAS_CF_PROFILE: profile }),
    ...(accountId === undefined ? {} : { CLOUDFLARE_ACCOUNT_ID: accountId }),
  };
  let token = env.CLOUDFLARE_API_TOKEN;
  let expiresAt = null;
  if (token !== undefined && token !== "") {
    if (!validToken(token)) throw new Error("CLOUDFLARE_API_TOKEN is invalid.");
  } else {
    if (!PROFILE.test(env.ATLAS_CF_PROFILE ?? ""))
      throw new Error("An explicit valid ATLAS_CF_PROFILE is required.");
    let credential;
    try {
      credential = await loader(env.ATLAS_CF_PROFILE);
    } catch {
      throw new Error(
        "Cloudflare credential loading failed; credential diagnostics were suppressed.",
      );
    }
    token = credential?.oauth_token;
    expiresAt =
      typeof credential?.expiration_time === "string"
        ? Date.parse(credential.expiration_time)
        : NaN;
    if (!validToken(token) || !Number.isFinite(expiresAt) || expiresAt <= now())
      throw new Error(
        "The OAuth credential is missing, invalid, or expired; renew it explicitly before starting a session.",
      );
  }
  const childEnv = Object.freeze({ ...env, CLOUDFLARE_API_TOKEN: token });
  const session = { expiresAt };
  // Accidental logging or JSON serialization of the session never includes env.
  Object.defineProperties(session, {
    env: { value: childEnv },
    [SESSION]: { value: true },
    [inspect.custom]: {
      value: () => ({ expiresAt, credential: "[REDACTED]" }),
    },
  });
  return Object.freeze(session);
}

function redactedOutput(token, write) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  function flush(final = false) {
    let index;
    while ((index = pending.indexOf(token)) !== -1) {
      write(pending.slice(0, index) + "[REDACTED]");
      pending = pending.slice(index + token.length);
    }
    const count = final
      ? pending.length
      : Math.max(0, pending.length - token.length + 1);
    if (count) {
      write(pending.slice(0, count));
      pending = pending.slice(count);
    }
  }
  return {
    write(chunk) {
      pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
      flush();
    },
    end() {
      pending += decoder.end();
      flush(true);
    },
  };
}

export function runSessionChild(command, args, options, output) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["inherit", "pipe", "pipe"],
    });
    child.stdout.on("data", output.stdout);
    child.stderr.on("data", output.stderr);
    const forward = (signal) => child.kill(signal);
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", () => {
      cleanup();
      reject(new Error("Child could not start."));
    });
    child.once("close", (code, signal) => {
      cleanup();
      resolveResult({ code, signal });
    });
  });
}

/** Run trusted deployment tooling with one bearer; provider operations remain cf CLI. */
export async function runCloudflareSession(
  command,
  {
    session,
    env = process.env,
    loader = loadPinnedOAuthCredential,
    runner = runSessionChild,
    now = Date.now,
    cwd = ROOT,
    stdout = (chunk) => process.stdout.write(chunk),
    stderr = (chunk) => process.stderr.write(chunk),
  } = {},
) {
  if (
    !Array.isArray(command) ||
    !command.length ||
    command.some(
      (part) => typeof part !== "string" || !part || part.includes("\0"),
    )
  )
    throw new Error("A child command is required after --.");
  session ??= await createCloudflareSession({ env, loader, now });
  if (
    !session[SESSION] ||
    (session.expiresAt !== null && session.expiresAt <= now())
  )
    throw new Error(
      "The Cloudflare session is invalid or expired; start a new session explicitly.",
    );
  const token = session.env.CLOUDFLARE_API_TOKEN;
  if (command.some((part) => part.includes(token)))
    throw new Error(
      "Cloudflare credentials must not appear in command arguments.",
    );
  const out = redactedOutput(token, stdout);
  const err = redactedOutput(token, stderr);
  try {
    const result = await runner(
      command[0],
      command.slice(1),
      { cwd, env: session.env },
      {
        stdout: out.write,
        stderr: err.write,
      },
    );
    return Number.isInteger(result?.code) && result.code >= 0 ? result.code : 1;
  } catch {
    throw new Error(
      "Cloudflare session child failed; credential diagnostics were suppressed.",
    );
  } finally {
    out.end();
    err.end();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    if (process.argv[2] !== "--")
      throw new Error(
        "Usage: node scripts/deploy/cloudflare-session.mjs -- <command> [args...]",
      );
    process.exitCode = await runCloudflareSession(process.argv.slice(3));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
