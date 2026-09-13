/**
 * Confirming which Stripe account bootstrap is about to configure.
 *
 * Writing a catalog into the wrong Stripe account is the one mistake here that
 * costs real money to undo, so the operator sees the account before anything
 * is created.
 */

import Stripe from "stripe";
import { log, note, password, spinner } from "@clack/prompts";
import pc from "picocolors";
import { promptConfirm, promptOrExit } from "../../lib/ui.js";
import {
  type StripeRuntimeMode,
  validateStripeApiKeyMode,
  type StripeBootstrapTarget,
} from "./env.js";
import {
  formatStripeAccountPrompt,
  formatStripeAccountVerificationFailure,
  formatStripeApiKeyGuidanceNote,
  formatStripeApiKeyPromptMessage,
  formatStripeMetadataUnavailablePrompt,
  formatStripeVerificationRetryPrompt,
  stripeAccountDisplayName,
} from "./stripe-copy.js";

export function printStripeApiKeyGuidance(envMode: StripeRuntimeMode): void {
  const guidance = formatStripeApiKeyGuidanceNote(envMode);
  note(guidance.message, guidance.title);
}

interface ConfirmStripeAccountParams {
  apiKey: string;
  assumeYes: boolean;
  doctorMode: boolean;
  mode: StripeRuntimeMode;
  target: StripeBootstrapTarget;
}

interface ConfirmedStripeAccount {
  apiKey: string;
  stripe: Stripe;
}

export async function confirmStripeAccount(
  params: ConfirmStripeAccountParams,
): Promise<ConfirmedStripeAccount | null> {
  let apiKey = params.apiKey;

  while (true) {
    const stripe = new Stripe(apiKey, {
      apiVersion: "2026-06-24.dahlia",
    });
    const s = spinner();
    s.start("Checking which Stripe account this key can change...");

    let account: Stripe.Account;
    try {
      account = await stripe.accounts.retrieveCurrent();
    } catch (error) {
      const failure = formatStripeAccountVerificationFailure(error);
      s.stop(failure.summary);
      note(failure.message, failure.title);
      if (
        failure.canContinueWithoutAccountRead &&
        failure.accountId &&
        !params.doctorMode &&
        !params.assumeYes &&
        (await promptConfirm(
          formatStripeMetadataUnavailablePrompt(failure.accountId),
          true,
        ))
      ) {
        return { apiKey, stripe };
      }
      if (params.doctorMode || params.assumeYes) {
        throw error;
      }
      const retry = await promptConfirm(
        formatStripeVerificationRetryPrompt(),
        true,
      );
      if (!retry) {
        return null;
      }
      const candidate = await promptForStripeApiKey(params.mode);
      if (!candidate) {
        return null;
      }
      apiKey = candidate;
      continue;
    }

    const accountName = stripeAccountDisplayName(account);
    s.stop(`Stripe account found: ${pc.cyan(accountName)} (${params.mode})`);

    if (
      params.doctorMode ||
      params.assumeYes ||
      (await promptConfirm(
        formatStripeAccountPrompt({
          accountId: account.id,
          accountName,
          mode: params.mode,
          target: params.target,
        }),
        true,
      ))
    ) {
      return { apiKey, stripe };
    }

    const useDifferentKey = await promptConfirm(
      [
        "Enter a different Stripe API key now?",
        "",
        "Choose Yes to paste a key for the intended Stripe account.",
        "Choose No to stop Stripe setup without changing products, prices, coupons, or webhooks.",
      ].join("\n"),
      true,
    );
    if (!useDifferentKey) {
      return null;
    }

    const candidate = await promptForStripeApiKey(params.mode);
    if (!candidate) {
      return null;
    }
    apiKey = candidate;
  }
}

async function promptForStripeApiKey(
  mode: StripeRuntimeMode,
): Promise<string | null> {
  printStripeApiKeyGuidance(mode);
  const prompted = await promptOrExit(
    password({
      message: formatStripeApiKeyPromptMessage(mode),
    }),
  );
  if (typeof prompted !== "string" || !prompted.trim()) {
    return null;
  }
  const candidate = prompted.trim();
  try {
    validateStripeApiKeyMode(candidate, mode);
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    return null;
  }
  return candidate;
}
