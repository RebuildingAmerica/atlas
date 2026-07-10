import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { log, password, spinner } from "@clack/prompts";
import pc from "picocolors";
import { formatCloudflareTokenPromptMessage } from "../lib/cloudflare.js";
import { runCommand } from "../lib/shell.js";
import { logSubline, promptOrExit } from "../lib/ui.js";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const DOMAIN = "rebuildingus.org";
const NAMESPACE = "org.rebuildingus.atlas";
const TXT_TTL = 60;
const KEY_DIR = `${homedir()}/.config/mcp-publisher`;
const PRIV_PATH = `${KEY_DIR}/atlas.key`;
const PUB_PATH = `${KEY_DIR}/atlas.pub`;
const TOKEN_PATH = `${KEY_DIR}/cloudflare-token`;

export interface AcquiredToken {
  token: string;
  isStashed: boolean;
}

export function readPub(): string {
  return readFileSync(PUB_PATH, "utf8").trim();
}

export async function acquireToken(): Promise<AcquiredToken> {
  if (existsSync(TOKEN_PATH)) {
    const stashed = readFileSync(TOKEN_PATH, "utf8").trim();
    if (stashed.length > 0) {
      log.success(
        `Reusing stashed Cloudflare token from ${pc.dim(TOKEN_PATH)}`,
      );
      return { token: stashed, isStashed: true };
    }
  }
  const token = (await promptOrExit(
    password({
      message: formatCloudflareTokenPromptMessage({
        permissionsHint: "Zone > DNS > Edit",
        zoneHint: DOMAIN,
      }),
    }),
  )) as string;
  return { token, isStashed: false };
}

export function writeToken(token: string): void {
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_PATH, `${token}\n`, { mode: 0o600 });
}

export function lookupZoneId(token: string): string | null {
  const result = runCommand(
    `curl -s -H "Authorization: Bearer ${token}" "${CLOUDFLARE_API}/zones?name=${DOMAIN}" | jq -r '.result[0].id // empty'`,
  );
  if (!result.ok || !result.stdout) return null;
  return result.stdout;
}

export function lookupTxtRecordId(
  token: string,
  zoneId: string,
): string | null {
  const result = runCommand(
    `curl -s -H "Authorization: Bearer ${token}" "${CLOUDFLARE_API}/zones/${zoneId}/dns_records?type=TXT&name=${DOMAIN}" | jq -r '.result[] | select(.content | startswith("v=MCPv1;")) | .id' | head -1`,
  );
  if (!result.ok || !result.stdout) return null;
  return result.stdout;
}

export function upsertTxtRecord(
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

export function revokeToken(token: string): { ok: boolean } {
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

export function digTxt(): string | null {
  const result = runCommand(
    `dig +short ${DOMAIN} TXT @1.1.1.1 | grep -i MCPv1 | head -1`,
  );
  if (!result.ok || !result.stdout) return null;
  return result.stdout.replace(/^"|"$/g, "");
}

export async function waitForPropagation(
  expectedTxt: string,
): Promise<boolean> {
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

export function printPublisherContext(): void {
  logSubline(`Private key: ${pc.dim(PRIV_PATH)}`);
  logSubline(`Cloudflare TXT: ${pc.dim(`${DOMAIN} (TTL ${TXT_TTL})`)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { DOMAIN, KEY_DIR, NAMESPACE, PRIV_PATH, PUB_PATH, TOKEN_PATH, TXT_TTL };
