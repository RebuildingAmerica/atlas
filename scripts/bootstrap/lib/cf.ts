/**
 * Runs Cloudflare's `cf` CLI, pinned to one exact version.
 *
 * `cf` is Cloudflare's successor to Wrangler and covers the whole Cloudflare
 * API. It is still a beta, so Atlas pins the version and runs it through
 * `pnpm dlx` rather than installing it: it brings the `workerd` runtime, which
 * no other part of the repository needs. Upgrade by changing CF_CLI_VERSION
 * and running `pnpm bootstrap --access-gate --doctor` against the account.
 *
 * Commands read `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the
 * environment, take request bodies through `--body`, and print JSON.
 */

import { spawnSync } from "node:child_process";

export const CF_CLI_VERSION = "1.0.0-beta.5";
export const CF_CLI = `pnpm dlx cf@${CF_CLI_VERSION}`;

export interface CfCredentials {
  apiToken: string;
  accountId: string;
}

/** Runs one `cf` command and returns its parsed JSON output. */
export type CfRunner = (args: string[], body?: object) => unknown;

/** Raised when a `cf` command fails; the message never contains the token. */
export class CfCommandError extends Error {
  constructor(
    readonly command: string,
    readonly output: string,
  ) {
    super(`cf ${command} failed: ${output}`);
    this.name = "CfCommandError";
  }
}

/**
 * Builds a runner that calls the pinned `cf` with the given credentials.
 *
 * @param credentials - The Cloudflare API token and account the commands act on.
 */
export function createCfRunner(credentials: CfCredentials): CfRunner {
  return (args, body) => {
    const fullArgs = [
      "dlx",
      `cf@${CF_CLI_VERSION}`,
      ...args,
      ...(body ? ["--body", JSON.stringify(body)] : []),
    ];
    const result = spawnSync("pnpm", fullArgs, {
      encoding: "utf8",
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
        CLOUDFLARE_API_TOKEN: credentials.apiToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const command = args.join(" ");
    if (result.status !== 0) {
      throw new CfCommandError(
        command,
        (result.stderr || result.stdout).trim(),
      );
    }
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw new CfCommandError(command, "did not print JSON");
    }
  };
}
