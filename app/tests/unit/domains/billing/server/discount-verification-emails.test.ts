/* eslint-disable atlas-tests/no-test-file-locals */

import { afterEach, describe, expect, it, vi } from "vitest";

interface SentEmail {
  subject: string;
  text: string;
  to: string;
}

const mocks = vi.hoisted(() => ({
  emailSend: vi.fn<(message: SentEmail) => Promise<void>>(),
  getAuthDatabase: vi.fn(),
  getAuthPgPool: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));

vi.mock("@/platform/email/server/service", () => ({
  createEmailService: vi.fn(() => ({
    send: mocks.emailSend,
  })),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/auth-db", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));

const mockSqliteUserEmail = (email: string | null): void => {
  mocks.getAuthPgPool.mockReturnValue(null);
  mocks.getAuthDatabase.mockReturnValue({
    prepare: vi.fn(() => ({
      get: vi.fn(() => (email ? { email } : undefined)),
    })),
  });
};

describe("discount verification emails", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.emailSend.mockReset();
    mocks.getAuthDatabase.mockReset();
    mocks.getAuthPgPool.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
  });

  it("sends new request notifications to configured operator review recipients", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      captureUrl: "http://127.0.0.1:8025/messages",
      emailFrom: "Atlas <hello@atlas.test>",
      emailProvider: "capture",
      operatorAllowedEmails: new Set(["ops@rebuildingus.org", "reviewer@rebuildingus.org"]),
      publicBaseUrl: "https://atlas.test",
      resendApiKey: null,
    });

    const { sendDiscountRequestOperatorNotification } =
      await import("@/domains/billing/server/discount-verification-emails");

    await sendDiscountRequestOperatorNotification({
      organizationId: "org_123",
      segment: "grassroots_nonprofit",
      verificationId: "verif_123",
    });

    expect(mocks.emailSend).toHaveBeenCalledTimes(2);
    const operatorMessages = mocks.emailSend.mock.calls.map(([message]) => message);
    expect(operatorMessages[0]).toMatchObject({
      subject: "New Atlas discount request",
      to: "ops@rebuildingus.org",
    });
    expect(operatorMessages[1]).toMatchObject({
      subject: "New Atlas discount request",
      to: "reviewer@rebuildingus.org",
    });
    expect(operatorMessages[1]?.text).toContain("Grassroots nonprofit");
  });

  it("sends approved and rejected review results to the submitting user", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      captureUrl: "http://127.0.0.1:8025/messages",
      emailFrom: "Atlas <hello@atlas.test>",
      emailProvider: "capture",
      operatorAllowedEmails: new Set(["ops@rebuildingus.org"]),
      publicBaseUrl: "https://atlas.test",
      resendApiKey: null,
    });
    mockSqliteUserEmail("student@example.edu");

    const { sendDiscountReviewResultEmail } =
      await import("@/domains/billing/server/discount-verification-emails");

    await sendDiscountReviewResultEmail({
      segment: "student",
      status: "verified",
      userId: "user_123",
    });
    await sendDiscountReviewResultEmail({
      segment: "student",
      status: "rejected",
      userId: "user_123",
    });

    const approvalMessage = mocks.emailSend.mock.calls[0]?.[0];
    const rejectionMessage = mocks.emailSend.mock.calls[1]?.[0];
    expect(approvalMessage).toMatchObject({
      subject: "Your Atlas discount request was approved",
      to: "student@example.edu",
    });
    expect(approvalMessage?.text).toContain("approved");
    expect(rejectionMessage).toMatchObject({
      subject: "Your Atlas discount request was not approved",
      to: "student@example.edu",
    });
    expect(rejectionMessage?.text).toContain("not approved");
  });
});
