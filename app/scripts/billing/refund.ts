#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";
import { getAuthRuntimeConfig } from "../../src/domains/access/server/runtime";
import {
  executeOperatorRefund,
  previewOperatorRefund,
} from "../../src/domains/billing/server/refund-operator";

interface RefundArgs {
  execute: boolean;
  operator: string | null;
  reason: string | null;
  sessionId: string;
}

export function parseRefundArgs(argv: string[]): RefundArgs {
  const read = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };
  const sessionId = read("--session");
  if (!sessionId?.startsWith("cs_")) {
    throw new Error(
      "Usage: pnpm billing:refund --session cs_... [--operator email --reason text --execute]",
    );
  }
  return {
    execute: argv.includes("--execute"),
    operator: read("--operator"),
    reason: read("--reason"),
    sessionId,
  };
}

async function main(): Promise<void> {
  const args = parseRefundArgs(process.argv.slice(2));
  if (args.execute) {
    const operator = args.operator?.trim().toLowerCase();
    const allowed = getAuthRuntimeConfig().operatorAllowedEmails;
    if (!operator || !args.reason?.trim() || !allowed.has(operator)) {
      throw new Error("Execution requires an allowed operator email and a refund reason.");
    }
    const outcome = await executeOperatorRefund(args.sessionId, operator, args.reason);
    process.stdout.write(
      JSON.stringify(
        {
          mode: outcome.plan.stripeMode,
          purchase: outcome.plan.purchaseIntentId,
          refund: outcome.refundId,
          status: outcome.status,
          workspace: outcome.plan.workspaceId,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const plan = await previewOperatorRefund(args.sessionId);
  process.stdout.write(
    JSON.stringify(
      {
        action: "preview_only",
        amount: plan.amount,
        currency: plan.currency,
        mode: plan.stripeMode,
        product: plan.product,
        purchase: plan.purchaseIntentId,
        session: plan.sessionId,
        subscription: plan.subscriptionId,
        workspace: plan.workspaceId,
      },
      null,
      2,
    ) + "\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Refund command failed.");
    process.exitCode = 1;
  });
}
