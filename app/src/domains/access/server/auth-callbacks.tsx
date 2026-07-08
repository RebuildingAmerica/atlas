import { render } from "@react-email/render";
import { MagicLinkEmail } from "@/platform/email/templates/magic-link-email";
import { VerificationEmail } from "@/platform/email/templates/verification-email";
import { InvitationEmail } from "@/platform/email/templates/invitation-email";
import { createEmailService } from "@/platform/email/server/service";
import { getAuthRuntimeConfig, isAllowedEmail } from "./runtime";
import { normalizeEmail } from "./auth-support";
import { getAuthDatabase, getAuthPgPool } from "./auth-db";
import { ensureAuthReady } from "./auth";

/**
 * Result row returned when Atlas checks whether an email already belongs to at
 * least one Better Auth organization membership.
 */
interface StoredMembershipCountRow {
  membershipCount: number;
}

/**
 * Result row returned when Atlas checks whether an account exists for a given
 * email address.
 */
interface StoredUserCountRow {
  userCount: number;
}

async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  const runtime = getAuthRuntimeConfig();
  const emailService = createEmailService(runtime);
  const html = await render(<MagicLinkEmail url={url} />);
  await emailService.send({
    html,
    subject: "Sign in to Atlas",
    text: `Use this link to sign in to Atlas: ${url}`,
    to: email,
  });
}

async function sendVerificationEmailMessage(email: string, url: string): Promise<void> {
  const runtime = getAuthRuntimeConfig();
  const emailService = createEmailService(runtime);
  const html = await render(<VerificationEmail url={url} />);
  await emailService.send({
    html,
    subject: "Verify your Atlas email",
    text: `Verify your email for Atlas: ${url}`,
    to: email,
  });
}

async function sendOrganizationInvitationEmailMessage(
  email: string,
  invitationId: string,
  organizationName: string,
): Promise<void> {
  const runtime = getAuthRuntimeConfig();
  // Point at the one-click acceptance route: an unauthenticated invitee is
  // carried through sign-in and back, then has the invitation accepted and the
  // workspace activated automatically — no manual "Accept" hunt required.
  const acceptUrl = new URL(
    `/accept-invitation/${encodeURIComponent(invitationId)}`,
    runtime.publicBaseUrl,
  );

  const emailService = createEmailService(runtime);
  const html = await render(
    <InvitationEmail organizationName={organizationName} signInUrl={acceptUrl.toString()} />,
  );
  await emailService.send({
    html,
    subject: `Join ${organizationName} on Atlas`,
    text: `You've been invited to join ${organizationName} on Atlas. Open this link to accept: ${acceptUrl.toString()}`,
    to: email,
  });
}

export async function sendAtlasVerificationEmail(params: {
  user: { email: string };
  url: string;
}): Promise<void> {
  const { user, url } = params;
  await sendVerificationEmailMessage(user.email, url);
}

export async function sendAtlasOrganizationInvitation(params: {
  email: string;
  id: string;
  organization: { name: string };
}): Promise<void> {
  const { email, id, organization } = params;
  await sendOrganizationInvitationEmailMessage(email, id, organization.name);
}

async function hasPendingOrganizationInvitation(email: string): Promise<boolean> {
  const auth = await ensureAuthReady();
  const invitations = await auth.api.listUserInvitations({
    query: {
      email,
    },
  });

  for (const invitation of invitations) {
    if (invitation.status === "pending") {
      return true;
    }
  }

  return false;
}

async function hasExistingOrganizationMembership(email: string): Promise<boolean> {
  const pool = getAuthPgPool();
  if (pool) {
    const result = await pool.query<StoredMembershipCountRow>(
      'select count(member.id) as "membershipCount" from "user" inner join member on member."userId" = "user".id where lower("user".email) = $1',
      [email],
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- count(*) always yields a single aggregate row
    return result.rows[0]!.membershipCount > 0;
  }

  /* v8 ignore start -- defensive: getAuthDatabase only returns null in postgres mode, which the pool branch above already covers */
  const database = getAuthDatabase();
  if (!database) {
    throw new Error("Auth database unavailable in current mode");
  }
  /* v8 ignore stop */
  const statement = database.prepare(
    [
      "select count(member.id) as membershipCount",
      "from user",
      "inner join member on member.userId = user.id",
      "where lower(user.email) = ?",
    ].join(" "),
  );
  // count(*) always yields a single aggregate row.
  const membershipCountRow = statement.get(email) as StoredMembershipCountRow;
  return membershipCountRow.membershipCount > 0;
}

export async function hasExistingAccount(email: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  const pool = getAuthPgPool();

  if (pool) {
    const result = await pool.query<StoredUserCountRow>(
      'select count(id) as "userCount" from "user" where lower(email) = $1',
      [normalizedEmail],
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- count(*) always yields a single aggregate row
    return result.rows[0]!.userCount > 0;
  }

  const database = getAuthDatabase();
  /* v8 ignore start -- defensive: getAuthDatabase only returns null in postgres mode, which the pool branch above already covers */
  if (!database) {
    throw new Error("Auth database unavailable in current mode");
  }
  /* v8 ignore stop */

  const statement = database.prepare(
    "select count(id) as userCount from user where lower(email) = ?",
  );
  // count(*) always yields a single aggregate row.
  const row = statement.get(normalizedEmail) as StoredUserCountRow;
  return row.userCount > 0;
}

export async function canEmailAccessAtlas(email: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  const runtime = getAuthRuntimeConfig();

  if (runtime.openRegistration) {
    return true;
  }

  if (isAllowedEmail(normalizedEmail)) {
    return true;
  }

  if (runtime.localMode) {
    return false;
  }

  if (await hasExistingOrganizationMembership(normalizedEmail)) {
    return true;
  }

  try {
    const hasPendingInvitation = await hasPendingOrganizationInvitation(normalizedEmail);
    return hasPendingInvitation;
  } catch {
    return false;
  }
}

export function createMagicLinkSender(
  deliverMagicLink: (email: string, url: string) => Promise<void> = sendMagicLinkEmail,
) {
  return async function atlasMagicLinkSender(params: {
    email: string;
    url: string;
  }): Promise<void> {
    const { email, url } = params;
    const emailCanAccessAtlas = await canEmailAccessAtlas(email);
    if (!emailCanAccessAtlas) {
      return;
    }

    await deliverMagicLink(email, url);
  };
}

export function createVerificationEmailSender(
  deliverVerificationEmail: (
    email: string,
    url: string,
  ) => Promise<void> = sendVerificationEmailMessage,
) {
  return async function atlasVerificationEmailSender(params: {
    email: string;
    url: string;
  }): Promise<void> {
    const { email, url } = params;
    await deliverVerificationEmail(email, url);
  };
}
