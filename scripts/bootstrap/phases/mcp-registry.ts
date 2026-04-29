import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log, password, select, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../lib/types.js";
import { commandOutput, runCommand } from "../lib/shell.js";
import { logSubline, promptConfirm, promptOrExit } from "../lib/ui.js";

const KEY_DIR = join(homedir(), ".config", "mcp-publisher");
const PRIV_PATH = join(KEY_DIR, "atlas.key");
const PUB_PATH = join(KEY_DIR, "atlas.pub");
const TOKEN_PATH = join(KEY_DIR, "cloudflare-token");

const DOMAIN = "rebuildingus.org";
const NAMESPACE = "org.rebuildingus.atlas";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const TXT_TTL = 60;

export async function runMcpRegistryPhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];

  if (!runCommand("command -v mcp-publisher").ok) {
    log.warn(
      "mcp-publisher CLI not installed. Run install phase or `brew install mcp-publisher`, then re-run.",
    );
    followUpItems.push("Install mcp-publisher CLI: brew install mcp-publisher");
    return { success: false, followUpItems };
  }

  if (!doctorMode) {
    const proceed = await promptConfirm(
      "Set up MCP Registry publisher (DNS proof on rebuildingus.org)?",
      false,
    );
    if (!proceed) {
      logSubline(
        pc.dim("Skipped — re-run anytime with `pnpm bootstrap --resume`."),
      );
      return { success: true, followUpItems: [] };
    }
  }

  const keypairResult = await ensureKeypair(
    projectRoot,
    doctorMode,
    followUpItems,
  );
  if (!keypairResult.ok) {
    return { success: false, followUpItems };
  }
  const expectedTxt = `v=MCPv1; k=ed25519; p=${keypairResult.pubBase64}`;

  const dnsResult = await ensureCloudflareTxt(
    expectedTxt,
    doctorMode,
    followUpItems,
  );
  if (!dnsResult.ok) {
    return { success: false, followUpItems };
  }

  const verifyResult = verifyAuth(doctorMode, followUpItems);
  if (!verifyResult) {
    return { success: false, followUpItems };
  }

  log.success(
    `MCP Registry publisher ready for ${pc.cyan(NAMESPACE)} namespace.`,
  );
  logSubline(`Private key: ${pc.dim(PRIV_PATH)}`);
  logSubline(`Cloudflare TXT: ${pc.dim(`${DOMAIN} (TTL ${TXT_TTL})`)}`);

  return { success: true, followUpItems };
}

interface KeypairResult {
  ok: boolean;
  pubBase64: string;
}

async function ensureKeypair(
  projectRoot: string,
  doctorMode: boolean,
  followUpItems: string[],
): Promise<KeypairResult> {
  const existing = existsSync(PRIV_PATH) && existsSync(PUB_PATH);

  if (existing) {
    log.success(`Publisher keypair present at ${pc.dim(KEY_DIR)}`);
    if (doctorMode) {
      return { ok: true, pubBase64: readPub() };
    }
    const choice = (await promptOrExit(
      select({
        message: "Existing keypair found",
        options: [
          { value: "keep", label: "Keep existing keypair" },
          {
            value: "rotate",
            label: "Rotate (generate new keypair, overwrite local files)",
            hint: "DNS will need updating too",
          },
        ],
      }),
    )) as "keep" | "rotate";
    if (choice === "keep") {
      return { ok: true, pubBase64: readPub() };
    }
  } else if (doctorMode) {
    log.warn(`No publisher keypair at ${pc.dim(KEY_DIR)}`);
    followUpItems.push(
      "Generate MCP publisher keypair: pnpm mcp:gen-publisher-key",
    );
    return { ok: false, pubBase64: "" };
  }

  const s = spinner();
  s.start("Generating Ed25519 keypair...");
  const genCmd = existing
    ? "pnpm --silent mcp:gen-publisher-key --force"
    : "pnpm --silent mcp:gen-publisher-key";
  const result = runCommand(`cd "${projectRoot}" && ${genCmd}`);
  if (!result.ok) {
    s.stop("Keypair generation failed");
    log.error(commandOutput(result));
    followUpItems.push("Run `pnpm mcp:gen-publisher-key` manually");
    return { ok: false, pubBase64: "" };
  }
  s.stop("Keypair generated and persisted");
  return { ok: true, pubBase64: readPub() };
}

function readPub(): string {
  return readFileSync(PUB_PATH, "utf8").trim();
}

interface DnsResult {
  ok: boolean;
}

async function ensureCloudflareTxt(
  expectedTxt: string,
  doctorMode: boolean,
  followUpItems: string[],
): Promise<DnsResult> {
  const liveTxt = digTxt();
  if (liveTxt === expectedTxt) {
    log.success(`Cloudflare TXT on ${DOMAIN} matches local pubkey`);
    return { ok: true };
  }

  if (liveTxt) {
    log.warn(`Cloudflare TXT on ${DOMAIN} is out of sync with local pubkey`);
    logSubline(pc.dim(`Live: ${liveTxt}`));
    logSubline(pc.dim(`Want: ${expectedTxt}`));
  } else {
    log.warn(`No MCPv1 TXT record found on ${DOMAIN}`);
  }

  if (doctorMode) {
    followUpItems.push(`Update Cloudflare TXT on ${DOMAIN} to: ${expectedTxt}`);
    return { ok: false };
  }

  const method = (await promptOrExit(
    select({
      message: "How should the TXT record be updated?",
      options: [
        {
          value: "api",
          label: "Cloudflare API (automated)",
          hint: "Needs an API token with Zone:DNS:Edit on rebuildingus.org",
        },
        {
          value: "dashboard",
          label: "I'll add it manually in the Cloudflare dashboard",
          hint: "Bootstrap will wait and verify",
        },
      ],
    }),
  )) as "api" | "dashboard";

  if (method === "api") {
    return await updateViaApi(expectedTxt, followUpItems);
  }
  return await updateViaDashboard(expectedTxt, followUpItems);
}

function digTxt(): string | null {
  const result = runCommand(
    `dig +short ${DOMAIN} TXT @1.1.1.1 | grep -i MCPv1 | head -1`,
  );
  if (!result.ok || !result.stdout) return null;
  return result.stdout.replace(/^"|"$/g, "");
}

async function updateViaApi(
  expectedTxt: string,
  followUpItems: string[],
): Promise<DnsResult> {
  const tokenResult = await acquireToken();
  if (!tokenResult.token) {
    followUpItems.push("Provide a Cloudflare API token to set the TXT record");
    return { ok: false };
  }
  const { token, isStashed } = tokenResult;

  const zoneId = lookupZoneId(token);
  if (!zoneId) {
    log.error(`Could not resolve zone id for ${DOMAIN}. Check token scopes.`);
    followUpItems.push(
      "Verify Cloudflare API token has Zone:DNS:Edit on rebuildingus.org",
    );
    return { ok: false };
  }

  const recordId = lookupTxtRecordId(token, zoneId);
  const apiResult = upsertTxtRecord(token, zoneId, recordId, expectedTxt);
  if (!apiResult.ok) {
    log.error(commandOutput(apiResult));
    followUpItems.push("Update Cloudflare TXT record manually");
    return { ok: false };
  }
  log.success(
    recordId
      ? "Updated Cloudflare TXT record"
      : "Created Cloudflare TXT record",
  );

  if (!(await waitForPropagation(expectedTxt))) {
    followUpItems.push(
      `DNS not propagated yet — re-verify with: dig +short ${DOMAIN} TXT @1.1.1.1`,
    );
    return { ok: false };
  }

  if (!isStashed) {
    const stash = await promptConfirm(
      `Save this token to ${TOKEN_PATH} (chmod 600) for future rotations?`,
      true,
    );
    if (stash) {
      writeToken(token);
      log.success(`Token saved to ${pc.dim(TOKEN_PATH)}`);
    } else {
      const revoke = await promptConfirm(
        "Revoke the token now (recommended if not stashing)?",
        true,
      );
      if (revoke) {
        const revokeResult = revokeToken(token);
        if (revokeResult.ok) {
          log.success("Cloudflare API token revoked");
        } else {
          log.warn(
            "Token revocation failed — revoke manually in the Cloudflare dashboard",
          );
          followUpItems.push(
            "Manually revoke the Cloudflare API token used for MCP setup",
          );
        }
      } else {
        followUpItems.push(
          "Remember to revoke the Cloudflare API token when no longer needed",
        );
      }
    }
  }

  return { ok: true };
}

interface AcquiredToken {
  token: string;
  isStashed: boolean;
}

async function acquireToken(): Promise<AcquiredToken> {
  if (existsSync(TOKEN_PATH)) {
    const stashed = readFileSync(TOKEN_PATH, "utf8").trim();
    if (stashed.length > 0) {
      log.success(
        `Reusing stashed Cloudflare token from ${pc.dim(TOKEN_PATH)}`,
      );
      return { token: stashed, isStashed: true };
    }
  }
  logSubline(
    pc.dim(
      `Create one at https://dash.cloudflare.com/profile/api-tokens (template "Edit zone DNS", restrict to ${DOMAIN}).`,
    ),
  );
  const token = (await promptOrExit(
    password({
      message: "Cloudflare API token",
    }),
  )) as string;
  return { token, isStashed: false };
}

function writeToken(token: string): void {
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_PATH, `${token}\n`, { mode: 0o600 });
}

function lookupZoneId(token: string): string | null {
  const result = runCommand(
    `curl -s -H "Authorization: Bearer ${token}" "${CLOUDFLARE_API}/zones?name=${DOMAIN}" | jq -r '.result[0].id // empty'`,
  );
  if (!result.ok || !result.stdout) return null;
  return result.stdout;
}

function lookupTxtRecordId(token: string, zoneId: string): string | null {
  const result = runCommand(
    `curl -s -H "Authorization: Bearer ${token}" "${CLOUDFLARE_API}/zones/${zoneId}/dns_records?type=TXT&name=${DOMAIN}" | jq -r '.result[] | select(.content | startswith("v=MCPv1;")) | .id' | head -1`,
  );
  if (!result.ok || !result.stdout) return null;
  return result.stdout;
}

function upsertTxtRecord(
  token: string,
  zoneId: string,
  recordId: string | null,
  expectedTxt: string,
): { ok: boolean; stdout: string; stderr: string } {
  const body = JSON.stringify({
    type: "TXT",
    name: DOMAIN,
    content: expectedTxt,
    ttl: TXT_TTL,
    comment: `MCP Registry publisher proof for ${NAMESPACE}.* namespace`,
  });
  const url = recordId
    ? `${CLOUDFLARE_API}/zones/${zoneId}/dns_records/${recordId}`
    : `${CLOUDFLARE_API}/zones/${zoneId}/dns_records`;
  const method = recordId ? "PATCH" : "POST";
  return runCommand(
    `curl -fs -X ${method} -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}' "${url}"`,
  );
}

function revokeToken(token: string): { ok: boolean } {
  const verify = runCommand(
    `curl -s -H "Authorization: Bearer ${token}" "${CLOUDFLARE_API}/user/tokens/verify" | jq -r '.result.id // empty'`,
  );
  if (!verify.ok || !verify.stdout) return { ok: false };
  const tokenId = verify.stdout;
  const del = runCommand(
    `curl -fs -X DELETE -H "Authorization: Bearer ${token}" "${CLOUDFLARE_API}/user/tokens/${tokenId}"`,
  );
  return { ok: del.ok };
}

async function updateViaDashboard(
  expectedTxt: string,
  followUpItems: string[],
): Promise<DnsResult> {
  log.info("Add or update the TXT record in Cloudflare:");
  logSubline(
    `URL:    https://dash.cloudflare.com/?to=/:account/${DOMAIN}/dns/records`,
  );
  logSubline(`Type:   TXT`);
  logSubline(`Name:   @ (apex)`);
  logSubline(`TTL:    ${TXT_TTL}`);
  logSubline(`Value:  ${expectedTxt}`);

  const ready = await promptConfirm("TXT record added or updated?", false);
  if (!ready) {
    followUpItems.push(
      `Add Cloudflare TXT on ${DOMAIN} apex with: ${expectedTxt}`,
    );
    return { ok: false };
  }

  if (!(await waitForPropagation(expectedTxt))) {
    followUpItems.push(
      `DNS not propagated yet — re-verify with: dig +short ${DOMAIN} TXT @1.1.1.1`,
    );
    return { ok: false };
  }
  return { ok: true };
}

async function waitForPropagation(expectedTxt: string): Promise<boolean> {
  const s = spinner();
  s.start(`Waiting for TXT record on ${DOMAIN} (TTL ${TXT_TTL}s)...`);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (digTxt() === expectedTxt) {
      s.stop("TXT record propagated");
      return true;
    }
    await sleep(5_000);
  }
  s.stop("TXT record did not propagate within 3 minutes");
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function verifyAuth(doctorMode: boolean, followUpItems: string[]): boolean {
  if (doctorMode) {
    return true;
  }
  const s = spinner();
  s.start("Verifying mcp-publisher login against the registry...");
  const result = runCommand(
    `mcp-publisher login dns --domain ${DOMAIN} --private-key "$(cat ${PRIV_PATH})"`,
  );
  if (!result.ok) {
    s.stop("Registry login failed");
    log.error(commandOutput(result));
    followUpItems.push(
      `Run manually: mcp-publisher login dns --domain ${DOMAIN} --private-key "$(cat ${PRIV_PATH})"`,
    );
    return false;
  }
  s.stop("Registry login succeeded");
  return true;
}
