import { existsSync } from "node:fs";
import { log, note, select } from "@clack/prompts";
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

export function formatExistingPublisherKeypairPromptMessage(): string {
  return [
    "Existing MCP Registry publisher keypair",
    "",
    "Bootstrap found a local publisher keypair for the Atlas MCP Registry namespace.",
    "1. Keep it if this machine already publishes the Atlas namespace.",
    "2. Rotate only if the key was compromised or this should become the new publisher key.",
    "3. Rotating generates new local key files and requires updating the Cloudflare TXT proof.",
    "4. If you rotate, bootstrap will update Cloudflare next after confirming API access.",
  ].join("\n");
}

export function formatMcpTxtUpdatePromptMessage(): string {
  return [
    "MCP Registry DNS proof",
    "",
    "Atlas must publish an MCPv1 TXT record on rebuildingus.org before the registry accepts the namespace.",
    "1. Choose Cloudflare API if bootstrap should create or update the TXT record for you.",
    "2. Choose dashboard if you want to paste the TXT record into Cloudflare manually.",
    "3. Stop if you are not sure which publisher key is correct.",
    "4. Bootstrap will wait for DNS and verify the live TXT record before continuing.",
  ].join("\n");
}

export interface McpTxtMismatchMessageOptions {
  domain: string;
  liveTxt: string | null;
  expectedTxt: string;
}

export function formatMcpTxtMismatchMessage(
  options: McpTxtMismatchMessageOptions,
): string {
  const currentProof = options.liveTxt ?? "No MCPv1 TXT record is live.";
  return [
    `Cloudflare currently trusts a different publisher key for ${options.domain} than the one saved on this machine.`,
    "Publishing will fail until DNS and the local key agree.",
    "",
    "Usually choose:",
    "1. Update Cloudflare if you intentionally rotated or generated this local key.",
    "2. Stop and restore the previous local publisher key if this machine should keep using the key already published in DNS.",
    "",
    "Current DNS proof:",
    currentProof,
    "",
    "Local key bootstrap wants:",
    options.expectedTxt,
  ].join("\n");
}

export type McpPublisherKeypairAction = "created" | "kept" | "rotated";

export interface McpTxtAutofixOptions {
  keypairAction: McpPublisherKeypairAction;
  liveTxt: string | null;
  doctorMode: boolean;
}

export function shouldAutofixMcpTxtMismatch(
  options: McpTxtAutofixOptions,
): boolean {
  if (options.doctorMode) return false;
  if (options.keypairAction === "rotated") return true;
  return options.keypairAction === "created" && options.liveTxt === null;
}

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
      [
        "Set up MCP Registry publisher?",
        "",
        "Bootstrap will create or verify the Atlas publisher keypair and the DNS proof on rebuildingus.org.",
        "Choose Yes if this machine should be able to publish the Atlas MCP Registry namespace.",
        "Choose No to skip publisher setup for now.",
      ].join("\n"),
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
    keypairResult.action,
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
  action: McpPublisherKeypairAction;
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
      return { ok: true, pubBase64: readPub(), action: "kept" };
    }
    const selected = (await promptOrExit(
      select({
        message: formatExistingPublisherKeypairPromptMessage(),
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
      return { ok: true, pubBase64: readPub(), action: "kept" };
    }
  } else if (doctorMode) {
    log.warn(`No publisher keypair at ${pc.dim(KEY_DIR)}`);
    followUpItems.push(
      "Generate MCP publisher keypair: pnpm mcp:gen-publisher-key",
    );
    return { ok: false, pubBase64: "", action: "kept" };
  }

  const result = runCommand(
    `cd "${projectRoot}" && pnpm --silent mcp:gen-publisher-key${existing ? " --force" : ""}`,
  );
  if (!result.ok) {
    log.error(commandOutput(result));
    followUpItems.push("Run `pnpm mcp:gen-publisher-key` manually");
    return { ok: false, pubBase64: "", action: "kept" };
  }
  return {
    ok: true,
    pubBase64: readPub(),
    action: existing ? "rotated" : "created",
  };
}

interface DnsResult {
  ok: boolean;
}

async function ensureCloudflareTxt(
  expectedTxt: string,
  doctorMode: boolean,
  followUpItems: string[],
  keypairAction: McpPublisherKeypairAction,
): Promise<DnsResult> {
  const liveTxt = digTxt();
  if (liveTxt === expectedTxt) {
    log.success(`Cloudflare TXT on ${DOMAIN} matches local pubkey`);
    return { ok: true };
  }

  log.warn(
    `Cloudflare TXT on ${DOMAIN} does not match the local publisher key`,
  );
  note(
    formatMcpTxtMismatchMessage({
      domain: DOMAIN,
      liveTxt,
      expectedTxt,
    }),
    "MCP Registry DNS proof mismatch",
  );

  if (doctorMode) {
    followUpItems.push(
      `Decide whether the local MCP publisher key should replace the Cloudflare TXT proof on ${DOMAIN}`,
    );
    followUpItems.push(
      `If yes, update Cloudflare TXT on ${DOMAIN} to: ${expectedTxt}`,
    );
    followUpItems.push(
      "If no, restore the publisher keypair that matches the live Cloudflare TXT proof",
    );
    return { ok: false };
  }

  if (
    shouldAutofixMcpTxtMismatch({
      keypairAction,
      liveTxt,
      doctorMode,
    })
  ) {
    log.info(
      keypairAction === "rotated"
        ? "Autofix: updating Cloudflare to the publisher key you just rotated."
        : "Autofix: creating the first Cloudflare TXT proof for this publisher key.",
    );
    return await updateViaApi(expectedTxt, followUpItems);
  }

  const selected = (await promptOrExit(
    select({
      message: formatMcpTxtUpdatePromptMessage(),
      options: [
        {
          value: "api",
          label: "Cloudflare API (automated)",
          hint: "Needs Account API token DNS Edit and Zone Read on rebuildingus.org",
        },
        {
          value: "dashboard",
          label: "I'll add it manually in the Cloudflare dashboard",
          hint: "Bootstrap will wait and verify",
        },
        {
          value: "stop",
          label: "Stop - I need to verify the publisher key first",
          hint: "No DNS changes",
        },
      ],
    }),
  )) as "api" | "dashboard" | "stop";

  if (selected === "stop") {
    followUpItems.push(
      `Verify whether ${PUB_PATH} should replace the live Cloudflare TXT proof on ${DOMAIN}`,
    );
    followUpItems.push(
      "Restore the previous MCP publisher keypair if this machine should not become the publisher",
    );
    return { ok: false };
  }

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
      "Verify the Cloudflare Account API token is scoped to rebuildingus.org with DNS & Zones > DNS > Edit and DNS & Zones > Zone > Read",
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
      [
        "Save Cloudflare token for future MCP DNS rotations?",
        "",
        `Bootstrap will write the token to ${TOKEN_PATH} with chmod 600.`,
        "Choose Yes if this machine should be able to rotate the DNS proof later.",
        "Choose No if this was a one-time token.",
      ].join("\n"),
      true,
    );
    if (stash) {
      writeToken(token);
      log.success(`Token saved to ${pc.dim(TOKEN_PATH)}`);
    } else {
      const revoke = await promptConfirm(
        [
          "Revoke the Cloudflare token now?",
          "",
          "This is recommended when you chose not to save the token locally.",
          "Choose Yes to ask Cloudflare to revoke it now.",
          "Choose No only if you will manage or revoke it manually.",
        ].join("\n"),
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

  const ready = await promptConfirm(
    [
      "Confirm MCP Registry TXT record is live",
      "",
      "Add or update the Cloudflare TXT record shown above first.",
      "Choose Yes after the Cloudflare dashboard shows the MCPv1 TXT record on the apex domain.",
      "Bootstrap will verify DNS propagation before continuing.",
    ].join("\n"),
    false,
  );
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
