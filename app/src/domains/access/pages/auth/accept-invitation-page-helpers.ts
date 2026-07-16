import type {
  AtlasSessionPayload,
  AtlasWorkspaceInvitation,
} from "@rebuildingamerica/atlas-access/workspace/organization-contracts";

/**
 * Terminal outcomes the one-click acceptance page renders after a signed-in
 * operator's acceptance attempt resolves.  Each maps to its own safe,
 * non-enumerating copy block.  `unavailable` deliberately collapses
 * already-accepted, expired, canceled, and unknown invitations into one state
 * so the page never reveals whether a given invitation id exists.
 */
export const ACCEPT_INVITATION_OUTCOME = {
  ACCEPTED: "accepted",
  WRONG_ACCOUNT: "wrong_account",
  UNAVAILABLE: "unavailable",
} as const;

export type AcceptInvitationOutcomeStatus =
  (typeof ACCEPT_INVITATION_OUTCOME)[keyof typeof ACCEPT_INVITATION_OUTCOME];

/**
 * Result of an auto-accept attempt from the invitation landing page.
 *
 * `workspaceName` / `workspaceSlug` are populated only when the joined
 * workspace was known from the operator's session (the common path where the
 * fresh session lists the pending invitation); otherwise they are `null` and
 * the page shows generic success copy.
 */
export interface AcceptInvitationOutcome {
  status: AcceptInvitationOutcomeStatus;
  workspaceName: string | null;
  workspaceSlug: string | null;
}

/**
 * Builds the sign-in URL that carries an invitation through authentication and
 * returns the visitor to the one-click acceptance landing page afterward.
 *
 * Both the invitation id and the self-referential redirect are encoded so an
 * id containing URL-significant characters round-trips intact.  The sign-in
 * page already understands `invitation` and `redirect`, so no sign-in changes
 * are required for the invitee to land back here signed in.
 *
 * @param invitationId - The Better Auth invitation id from the route params.
 */
export function buildInvitationSignInPath(invitationId: string): string {
  const landingPath = `/accept-invitation/${encodeURIComponent(invitationId)}`;
  const search = new URLSearchParams({
    invitation: invitationId,
    redirect: landingPath,
  });
  return `/sign-in?${search.toString()}`;
}

/**
 * Pre-acceptance decision for a signed-in operator landing on the one-click
 * acceptance page.  `wrong_account` short-circuits acceptance when the
 * invitation is addressed to a different email than the operator is signed in
 * as; `accept` proceeds, carrying the matched invitation when the session
 * already knows about it (so the joined workspace can be named and activated)
 * or `null` when the cached session predates the invite.
 */
export type InvitationDecision =
  { kind: "wrong_account" } | { kind: "accept"; invitation: AtlasWorkspaceInvitation | null };

/**
 * Decides how to handle an invitation for the signed-in operator before any
 * acceptance call is made.
 *
 * The operator's session may already list the invitation among its pending
 * invitations.  When it does and the addressed email differs from the
 * operator's, Atlas stops with a precise "wrong account" decision instead of
 * letting Better Auth reject the acceptance with an opaque error.  Email
 * comparison is case-insensitive because Atlas normalizes addresses
 * elsewhere.  When the invitation is absent the session simply predates it, so
 * acceptance still proceeds — just without a known workspace to name up front.
 *
 * @param session - The signed-in operator's resolved Atlas session.
 * @param invitationId - The invitation id from the landing route.
 */
export function resolveInvitationDecision(
  session: AtlasSessionPayload,
  invitationId: string,
): InvitationDecision {
  const matchingInvitation = session.workspace.pendingInvitations.find(
    (invitation) => invitation.id === invitationId,
  );

  if (
    matchingInvitation &&
    matchingInvitation.email.toLowerCase() !== session.user.email.toLowerCase()
  ) {
    return { kind: "wrong_account" };
  }

  return { kind: "accept", invitation: matchingInvitation ?? null };
}
