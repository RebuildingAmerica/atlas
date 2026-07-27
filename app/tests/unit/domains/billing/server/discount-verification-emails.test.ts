/* eslint-disable atlas-tests/no-test-file-locals */

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqlitePgPool } from "../../../../helpers/sqlite-pg-pool";

interface SentEmail {
  subject: string;
  text: string;
  to: string;
}

interface EmailRuntimeOptions {
  operatorAllowedEmails?: string[];
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

const stubEmailRuntime = (options: EmailRuntimeOptions = {}): void => {
  mocks.getAuthRuntimeConfig.mockReturnValue({
    captureUrl: "http://127.0.0.1:8025/messages",
    emailFrom: "Atlas <hello@atlas.test>",
    emailProvider: "capture",
    operatorAllowedEmails: new Set(options.operatorAllowedEmails ?? ["ops@rebuildingus.org"]),
    publicBaseUrl: "https://atlas.test",
    resendApiKey: null,
  });
};

/**
 * Points the module at a real Postgres-shaped user table, so the `$1` query in
 * the Postgres branch actually runs rather than being asserted on as a call.
 */
const usePostgresUserTable = (rows: { email: string; id: string }[]): Database.Database => {
  const db = new Database(":memory:");
  db.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL)');
  for (const row of rows) {
    db.prepare('INSERT INTO "user" (id, email) VALUES (?, ?)').run(row.id, row.email);
  }
  mocks.getAuthDatabase.mockReturnValue(null);
  mocks.getAuthPgPool.mockReturnValue(createSqlitePgPool(db).pool);
  return db;
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

  it("sends nothing when no operator review recipients are configured", async () => {
    stubEmailRuntime({ operatorAllowedEmails: [] });

    const { sendDiscountRequestOperatorNotification } =
      await import("@/domains/billing/server/discount-verification-emails");

    await sendDiscountRequestOperatorNotification({
      organizationId: "org_123",
      segment: "student",
      verificationId: "verif_123",
    });

    expect(mocks.emailSend).not.toHaveBeenCalled();
  });

  it("puts the workspace, verification and review link in the operator notification", async () => {
    stubEmailRuntime();

    const { sendDiscountRequestOperatorNotification } =
      await import("@/domains/billing/server/discount-verification-emails");

    await sendDiscountRequestOperatorNotification({
      organizationId: "org_123",
      segment: "civic_tech_worker",
      verificationId: "verif_456",
    });

    const text = mocks.emailSend.mock.calls[0]?.[0].text ?? "";
    expect(text).toContain("Segment: Civic tech worker");
    expect(text).toContain("Workspace: org_123");
    expect(text).toContain("Verification: verif_456");
    expect(text).toContain("https://atlas.test/admin/discounts");
  });

  describe("looking up the submitter on Postgres", () => {
    it("emails the address stored against the submitting user", async () => {
      stubEmailRuntime();
      const db = usePostgresUserTable([
        { email: "someone-else@example.org", id: "user_other" },
        { email: "student@example.edu", id: "user_123" },
      ]);

      const { sendDiscountReviewResultEmail } =
        await import("@/domains/billing/server/discount-verification-emails");

      await sendDiscountReviewResultEmail({
        segment: "student",
        status: "verified",
        userId: "user_123",
      });

      expect(mocks.emailSend.mock.calls[0]?.[0]).toMatchObject({
        subject: "Your Atlas discount request was approved",
        to: "student@example.edu",
      });
      db.close();
    });

    it("refuses to send when the submitting user has no stored address", async () => {
      stubEmailRuntime();
      const db = usePostgresUserTable([]);

      const { sendDiscountReviewResultEmail } =
        await import("@/domains/billing/server/discount-verification-emails");

      await expect(
        sendDiscountReviewResultEmail({
          segment: "student",
          status: "verified",
          userId: "user_missing",
        }),
      ).rejects.toThrow("Discount request submitter email was not found.");
      expect(mocks.emailSend).not.toHaveBeenCalled();
      db.close();
    });
  });

  describe("without a usable auth database", () => {
    it("refuses to send a review result", async () => {
      stubEmailRuntime();
      mocks.getAuthPgPool.mockReturnValue(null);
      mocks.getAuthDatabase.mockReturnValue(null);

      const { sendDiscountReviewResultEmail } =
        await import("@/domains/billing/server/discount-verification-emails");

      await expect(
        sendDiscountReviewResultEmail({
          segment: "student",
          status: "verified",
          userId: "user_123",
        }),
      ).rejects.toThrow("Auth database unavailable in current mode.");
      expect(mocks.emailSend).not.toHaveBeenCalled();
    });

    it("refuses to send when SQLite has no row for the submitter", async () => {
      stubEmailRuntime();
      mockSqliteUserEmail(null);

      const { sendDiscountReviewResultEmail } =
        await import("@/domains/billing/server/discount-verification-emails");

      await expect(
        sendDiscountReviewResultEmail({
          segment: "student",
          status: "rejected",
          userId: "user_123",
        }),
      ).rejects.toThrow("Discount request submitter email was not found.");
    });
  });
});
