/**
 * `pnpm bootstrap --admin-keys`: makes the key pair the platform admin signs
 * its API calls with.
 *
 * The private key becomes the GitHub Environment secret
 * `ATLAS_ADMIN_SIGNING_KEY`, which the admin deploy uploads as a Worker
 * secret. The public key becomes the Environment variable
 * `ATLAS_ADMIN_SIGNING_PUBLIC_KEY`, which the API deploy adds to
 * `ATLAS_MACHINE_TRUSTED_ISSUERS`. The private key is handed to `gh` on stdin
 * and never written to disk or a command line.
 *
 * Running it again rotates the pair. Redeploy the API, then the admin, so the
 * API trusts the new key before the admin starts signing with it.
 */

import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { log } from "@clack/prompts";
import type { HostedDeployTarget } from "../lib/hosted-target.js";
import { runCommand } from "../lib/shell.js";
import { promptConfirm } from "../lib/ui.js";
import type { PhaseResult } from "../state.js";

export const ADMIN_SIGNING_KEY_SECRET = "ATLAS_ADMIN_SIGNING_KEY";
export const ADMIN_SIGNING_PUBLIC_KEY_VARIABLE =
  "ATLAS_ADMIN_SIGNING_PUBLIC_KEY";

export interface AdminSigningKeys {
  /** Base64 PKCS#8 DER, as the admin Worker imports it. */
  privateKeyPkcs8: string;
  /** Base64 raw 32-byte public key, as the API's ed25519_jwt issuer expects it. */
  publicKeyRaw: string;
}

export interface GhResult {
  ok: boolean;
  output: string;
}

/** Runs `gh` with arguments, optionally feeding stdin. */
export type GhRunner = (args: string[], stdin?: string) => GhResult;

export interface AdminKeysDeps {
  gh: GhRunner;
  confirm: (message: string) => Promise<boolean>;
  generate: () => AdminSigningKeys;
}

/** Generates a fresh Ed25519 key pair in the formats both sides read. */
export function generateAdminSigningKeys(): AdminSigningKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x) throw new Error("Ed25519 public key export had no x coordinate.");
  return {
    privateKeyPkcs8: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
    publicKeyRaw: Buffer.from(jwk.x, "base64url").toString("base64"),
  };
}

function runGh(args: string[], stdin?: string): GhResult {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input: stdin,
    stdio: "pipe",
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

const DEFAULT_DEPS: AdminKeysDeps = {
  gh: runGh,
  confirm: (message) => promptConfirm(message, false),
  generate: generateAdminSigningKeys,
};

/**
 * Creates or rotates the platform admin's signing key for one environment.
 *
 * @param repo - The GitHub repository, `owner/name`.
 * @param target - The GitHub Environment to write.
 * @param doctorMode - Report whether a key exists, changing nothing.
 * @param assumeYes - Rotate an existing key without asking.
 * @param deps - Command runner, prompt and key generator; real ones by default.
 */
export async function runAdminKeysPhase(
  repo: string,
  target: HostedDeployTarget,
  doctorMode: boolean,
  assumeYes: boolean,
  deps: AdminKeysDeps = DEFAULT_DEPS,
): Promise<PhaseResult> {
  const existing = deps.gh([
    "variable",
    "get",
    ADMIN_SIGNING_PUBLIC_KEY_VARIABLE,
    "--repo",
    repo,
    "--env",
    target,
  ]);
  const missing = !existing.ok && /was not found/i.test(existing.output);
  if (!existing.ok && !missing) {
    // An unreadable variable is not a missing one: treating it as missing would
    // replace a working key without asking.
    log.error(
      `Could not read ${ADMIN_SIGNING_PUBLIC_KEY_VARIABLE}: ${existing.output}`,
    );
    return {
      success: false,
      followUpItems: [
        `Check that gh can read the GitHub "${target}" Environment, then run this again`,
      ],
    };
  }
  const hasKey = existing.ok && existing.output.length > 0;

  if (doctorMode) {
    if (hasKey) {
      log.success(`The ${target} platform admin has a signing key.`);
      return { success: true, followUpItems: [] };
    }
    log.warn(`The ${target} platform admin has no signing key.`);
    const cliTarget = target === "production" ? "prod" : "staging";
    return {
      success: false,
      followUpItems: [
        `Create the ${target} admin signing key: pnpm bootstrap --admin-keys --target ${cliTarget}`,
      ],
    };
  }

  if (hasKey && !assumeYes) {
    const rotate = await deps.confirm(
      [
        `The ${target} platform admin already has a signing key. Rotate it?`,
        "",
        "Redeploy the API, then the admin, afterwards: until both run, the admin's calls are refused.",
      ].join("\n"),
    );
    if (!rotate) {
      log.info("Kept the existing admin signing key.");
      return { success: true, followUpItems: [] };
    }
  }

  const keys = deps.generate();
  const secret = deps.gh(
    [
      "secret",
      "set",
      ADMIN_SIGNING_KEY_SECRET,
      "--repo",
      repo,
      "--env",
      target,
    ],
    keys.privateKeyPkcs8,
  );
  if (!secret.ok) {
    log.error(`Could not store ${ADMIN_SIGNING_KEY_SECRET}: ${secret.output}`);
    return {
      success: false,
      followUpItems: [
        `Store ${ADMIN_SIGNING_KEY_SECRET} in the GitHub "${target}" Environment`,
      ],
    };
  }
  const variable = deps.gh([
    "variable",
    "set",
    ADMIN_SIGNING_PUBLIC_KEY_VARIABLE,
    "--body",
    keys.publicKeyRaw,
    "--repo",
    repo,
    "--env",
    target,
  ]);
  if (!variable.ok) {
    log.error(
      `Could not store ${ADMIN_SIGNING_PUBLIC_KEY_VARIABLE}: ${variable.output}`,
    );
    return {
      success: false,
      followUpItems: [
        `Store ${ADMIN_SIGNING_PUBLIC_KEY_VARIABLE} in the GitHub "${target}" Environment; the private key was already replaced`,
      ],
    };
  }

  log.success(`Stored the ${target} platform admin's signing key.`);
  return {
    success: true,
    followUpItems: hasKey
      ? [
          `Redeploy the ${target} API, then the ${target} platform admin, to finish rotating the key`,
        ]
      : [],
  };
}

/** Finds the GitHub repository this checkout deploys from. */
export function detectGithubRepo(): string | null {
  const result = runCommand(
    "gh repo view --json nameWithOwner -q '.nameWithOwner'",
  );
  return result.ok && result.stdout ? result.stdout : null;
}
