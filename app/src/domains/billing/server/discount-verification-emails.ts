import "@tanstack/react-start/server-only";

import { getAuthDatabase, getAuthPgPool } from "@/domains/access/server/auth-db";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";
import { createEmailService } from "@/platform/email/server/service";
import type { DiscountSegment } from "../discount-segments";

type ReviewResultStatus = "verified" | "rejected";

interface StoredUserEmailRow {
  email: string;
}

interface DiscountRequestOperatorNotification {
  organizationId: string;
  segment: DiscountSegment;
  verificationId: string;
}

interface DiscountReviewResultEmail {
  segment: DiscountSegment;
  status: ReviewResultStatus;
  userId: string;
}

const EMAIL_SEGMENT_LABELS: Record<DiscountSegment, string> = {
  civic_tech_worker: "Civic tech worker",
  grassroots_nonprofit: "Grassroots nonprofit",
  independent_journalist: "Independent creator or journalist",
  student: "Student",
};

async function getSubmitterEmail(userId: string): Promise<string> {
  const pgPool = getAuthPgPool();
  if (pgPool) {
    const result = await pgPool.query<StoredUserEmailRow>(
      'select email from "user" where id = $1 limit 1',
      [userId],
    );
    const email = result.rows[0]?.email;
    if (email) {
      return email;
    }
    throw new Error("Discount request submitter email was not found.");
  }

  const database = getAuthDatabase();
  if (!database) {
    throw new Error("Auth database unavailable in current mode.");
  }
  const row = database.prepare("select email from user where id = ? limit 1").get(userId) as
    StoredUserEmailRow | undefined;
  if (!row?.email) {
    throw new Error("Discount request submitter email was not found.");
  }
  return row.email;
}

function discountReviewUrl(publicBaseUrl: string): string {
  return new URL("/admin/discounts", publicBaseUrl).toString();
}

export async function sendDiscountRequestOperatorNotification({
  organizationId,
  segment,
  verificationId,
}: DiscountRequestOperatorNotification): Promise<void> {
  const runtime = getAuthRuntimeConfig();
  const recipients = [...runtime.operatorAllowedEmails].sort();
  if (recipients.length === 0) {
    return;
  }

  const emailService = createEmailService(runtime);
  const segmentLabel = EMAIL_SEGMENT_LABELS[segment];
  const reviewUrl = discountReviewUrl(runtime.publicBaseUrl);
  const text = [
    "A new Atlas discount request is ready for review.",
    "",
    `Segment: ${segmentLabel}`,
    `Workspace: ${organizationId}`,
    `Verification: ${verificationId}`,
    "",
    `Review it here: ${reviewUrl}`,
  ].join("\n");

  for (const recipient of recipients) {
    await emailService.send({
      subject: "New Atlas discount request",
      text,
      to: recipient,
    });
  }
}

export async function sendDiscountReviewResultEmail({
  segment,
  status,
  userId,
}: DiscountReviewResultEmail): Promise<void> {
  const runtime = getAuthRuntimeConfig();
  const emailService = createEmailService(runtime);
  const recipient = await getSubmitterEmail(userId);
  const segmentLabel = EMAIL_SEGMENT_LABELS[segment];

  if (status === "verified") {
    await emailService.send({
      subject: "Your Atlas discount request was approved",
      text: [
        `Your ${segmentLabel} discount request was approved.`,
        "",
        "Discounted access is available for your Atlas workspace.",
      ].join("\n"),
      to: recipient,
    });
    return;
  }

  await emailService.send({
    subject: "Your Atlas discount request was not approved",
    text: [
      `Your ${segmentLabel} discount request was not approved.`,
      "",
      "You can submit a new request if your eligibility changes.",
    ].join("\n"),
    to: recipient,
  });
}
