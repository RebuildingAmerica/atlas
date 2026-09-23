import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRuntimeConfig: vi.fn(),
  previewOperatorRefund: vi.fn(),
  executeOperatorRefund: vi.fn(),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));
vi.mock("@/domains/billing/server/refund-operator", () => ({
  previewOperatorRefund: mocks.previewOperatorRefund,
  executeOperatorRefund: mocks.executeOperatorRefund,
}));

import { parseRefundArgs, runRefundCli } from "../../../scripts/billing/refund";

describe("refund operator command", () => {
  const stdoutWrites: string[] = [];

  beforeEach(() => {
    stdoutWrites.length = 0;
    mocks.getAuthRuntimeConfig.mockReturnValue({
      operatorAllowedEmails: new Set(["ops@atlas.test"]),
    });
    mocks.previewOperatorRefund.mockResolvedValue({
      amount: 400,
      currency: "usd",
      product: "atlas_research_pass",
      purchaseIntentId: "purchase_1",
      sessionId: "cs_1",
      stripeMode: "test",
      subscriptionId: null,
      workspaceId: "org_1",
    });
    mocks.executeOperatorRefund.mockResolvedValue({
      plan: { stripeMode: "test", purchaseIntentId: "purchase_1", workspaceId: "org_1" },
      refundId: "re_1",
      status: "succeeded",
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("requires a Checkout session identifier", () => {
    expect(() => parseRefundArgs([])).toThrow("Usage:");
    expect(() => parseRefundArgs(["--session"])).toThrow("Usage:");
    expect(() => parseRefundArgs(["--session", "pi_1"])).toThrow("Usage:");
  });

  it("previews the purchase without requesting a refund", async () => {
    await runRefundCli(["--session", "cs_1"]);
    expect(mocks.previewOperatorRefund).toHaveBeenCalledWith("cs_1");
    expect(mocks.executeOperatorRefund).not.toHaveBeenCalled();
    expect(stdoutWrites[0]).toContain('"action": "preview_only"');
  });

  it.each([
    [[], "missing operator"],
    [["--operator", "ops@atlas.test"], "missing reason"],
    [["--operator", "other@atlas.test", "--reason", "Customer request"], "wrong operator"],
  ])("refuses execution with %s (%s)", async (extra) => {
    await expect(runRefundCli(["--session", "cs_1", "--execute", ...extra])).rejects.toThrow(
      "Execution requires an allowed operator email and a refund reason.",
    );
    expect(mocks.executeOperatorRefund).not.toHaveBeenCalled();
  });

  it("executes only for an allowed operator with a reason", async () => {
    await runRefundCli([
      "--session",
      "cs_1",
      "--execute",
      "--operator",
      " OPS@ATLAS.TEST ",
      "--reason",
      "Customer request",
    ]);
    expect(mocks.executeOperatorRefund).toHaveBeenCalledWith(
      "cs_1",
      "ops@atlas.test",
      "Customer request",
    );
    expect(stdoutWrites[0]).toContain('"refund": "re_1"');
  });
});
