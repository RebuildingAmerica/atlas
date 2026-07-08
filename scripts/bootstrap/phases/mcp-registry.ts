import { existsSync } from "node:fs";
import { log, select } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../state.js";
import { promptConfirm, promptOrExit } from "../lib/ui.js";
import { commandOutput, runCommand } from "../lib/shell.js";
import {
  acquireToken,
  DOMAIN,
  digTxt,
  lookupTxtRecordId,
  lookupZoneId,
  printPublisherContext,
  PRIV_PATH,
  readPub,
  revokeToken,
  TOKEN_PATH,
  PUB_PATH,
  upsertTxtRecord,
  waitForPropagation,
  writeToken,
  KEY_DIR,
  NAMESPACE,
} from "./mcp-registry-cloudflare.js";

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
      log.info("Skipped — re-run anytime with `pnpm bootstrap --resume`.");
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
  printPublisherContext();

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
    const selected = (await promptOrExit(
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
    if (selected === "keep") {
      return { ok: true, pubBase64: readPub() };
    }
  } else if (doctorMode) {
    log.warn(`No publisher keypair at ${pc.dim(KEY_DIR)}`);
    followUpItems.push(
      "Generate MCP publisher keypair: pnpm mcp:gen-publisher-key",
    );
    return { ok: false, pubBase64: "" };
  }

  const result = runCommand(
    `cd "${projectRoot}" && pnpm --silent mcp:gen-publisher-key${existing ? " --force" : ""}`,
  );
  if (!result.ok) {
    log.error(commandOutput(result));
    followUpItems.push("Run `pnpm mcp:gen-publisher-key` manually");
    return { ok: false, pubBase64: "" };
  }
  return { ok: true, pubBase64: readPub() };
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
    log.info(`Live: ${liveTxt}`);
    log.info(`Want: ${expectedTxt}`);
  } else {
    log.warn(`No MCPv1 TXT record found on ${DOMAIN}`);
  }

  if (doctorMode) {
    followUpItems.push(`Update Cloudflare TXT on ${DOMAIN} to: ${expectedTxt}`);
    return { ok: false };
  }

  const selected = (await promptOrExit(
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

  if (selected === "api") {
    return await updateViaApi(expectedTxt, followUpItems);
  }
  return await updateViaDashboard(expectedTxt, followUpItems);
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

async function updateViaDashboard(
  expectedTxt: string,
  followUpItems: string[],
): Promise<DnsResult> {
  log.info("Add or update the TXT record in Cloudflare:");
  log.info(
    `URL:    https://dash.cloudflare.com/?to=/:account/${DOMAIN}/dns/records`,
  );
  log.info(`Type:   TXT`);
  log.info(`Name:   @ (apex)`);
  log.info(`Value:  ${expectedTxt}`);

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

function verifyAuth(doctorMode: boolean, followUpItems: string[]): boolean {
  if (doctorMode) {
    return true;
  }
  const result = runCommand(
    `mcp-publisher login dns --domain ${DOMAIN} --private-key "$(cat ${PRIV_PATH})"`,
  );
  if (!result.ok) {
    log.error(commandOutput(result));
    followUpItems.push(
      `Run manually: mcp-publisher login dns --domain ${DOMAIN} --private-key "$(cat ${PRIV_PATH})"`,
    );
    return false;
  }
  return true;
}
