import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import {
  acceptWorkspaceInvitation,
  setActiveWorkspace,
} from "@/domains/access/organizations.functions";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";
import { Spinner } from "@rebuildingamerica/atlas-ui/ui/spinner";
import {
  ACCEPT_INVITATION_OUTCOME,
  buildInvitationSignInPath,
  resolveInvitationDecision,
  type AcceptInvitationOutcome,
} from "./accept-invitation-page-helpers";

interface AcceptInvitationPageProps {
  invitationId: string;
}

interface InvitationPanelProps {
  eyebrow: string;
  heading: string;
  body: string;
  action?: { label: string; to: string };
}

/**
 * Renders a single terminal panel for the acceptance flow.  Centralizing the
 * markup keeps every state visually consistent and guarantees there is always
 * a heading and body — the page is never a blank dead-end.
 *
 * @param props - Panel copy and optional call-to-action link.
 */
function InvitationPanel({ eyebrow, heading, body, action }: InvitationPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="type-label-medium text-ink-muted">{eyebrow}</p>
        <h1 className="type-display-small text-ink-strong">{heading}</h1>
        <p className="type-body-large text-ink-soft">{body}</p>
      </div>
      {action ? (
        <Link
          to={action.to}
          className="text-accent type-label-large inline-flex items-center hover:underline"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * One-click workspace-invitation acceptance landing page.
 *
 * An unauthenticated visitor is forwarded through sign-in carrying the
 * invitation, then returns here signed in.  A signed-in operator has the
 * invitation accepted automatically — exactly once — and the joined workspace
 * activated, before landing on success copy that deep-links into the
 * workspace.  Already-accepted, expired, canceled, unknown, and wrong-account
 * invitations all resolve to trustworthy, non-enumerating copy; raw acceptance
 * errors are never surfaced.
 *
 * @param props - Component props.
 * @param props.invitationId - The Better Auth invitation id from the route.
 */
export function AcceptInvitationPage({ invitationId }: AcceptInvitationPageProps) {
  const queryClient = useQueryClient();
  const atlasSession = useAtlasSession();
  const hasAttemptedRef = useRef(false);
  const [outcome, setOutcome] = useState<AcceptInvitationOutcome | null>(null);
  const [didFail, setDidFail] = useState(false);

  const acceptMutation = useMutation({
    mutationFn: async (session: AtlasSessionPayload): Promise<AcceptInvitationOutcome> => {
      const decision = resolveInvitationDecision(session, invitationId);
      if (decision.kind === "wrong_account") {
        return {
          status: ACCEPT_INVITATION_OUTCOME.WRONG_ACCOUNT,
          workspaceName: null,
          workspaceSlug: null,
        };
      }

      await acceptWorkspaceInvitation({ data: { invitationId } });

      // Activate and name the workspace only when the session already knew the
      // invitation.  When it did not, the session simply predated the invite;
      // acceptance still succeeded, and /organization surfaces the new
      // workspace for the operator to enter.
      if (decision.invitation) {
        await setActiveWorkspace({
          data: { organizationId: decision.invitation.organizationId },
        });
        return {
          status: ACCEPT_INVITATION_OUTCOME.ACCEPTED,
          workspaceName: decision.invitation.organizationName,
          workspaceSlug: decision.invitation.organizationSlug,
        };
      }

      return {
        status: ACCEPT_INVITATION_OUTCOME.ACCEPTED,
        workspaceName: null,
        workspaceSlug: null,
      };
    },
    onSuccess: async (result) => {
      setOutcome(result);
      await queryClient.invalidateQueries({ queryKey: [...atlasSessionQueryKey] });
    },
    onError: () => {
      // Collapse already-accepted / expired / canceled / unknown invitations —
      // and any unexpected acceptance error — into one generic outcome so the
      // raw error never reaches the operator and the id cannot be probed.
      setDidFail(true);
    },
  });

  const session = atlasSession.data;
  const isSignedOut = !atlasSession.isPending && session === null;

  // Not signed in: carry the invitation through sign-in and back to this page.
  useEffect(() => {
    if (!isSignedOut) {
      return;
    }
    window.location.assign(buildInvitationSignInPath(invitationId));
  }, [isSignedOut, invitationId]);

  // Signed in: auto-accept exactly once.
  useEffect(() => {
    if (atlasSession.isPending || !session || hasAttemptedRef.current) {
      return;
    }
    hasAttemptedRef.current = true;
    acceptMutation.mutate(session);
  }, [atlasSession.isPending, session, acceptMutation]);

  if (atlasSession.isPending) {
    return (
      <div className="space-y-4">
        <Spinner />
        <InvitationPanel
          eyebrow="Workspace invitation"
          heading="Checking your invitation"
          body="Hold on while Atlas confirms your invitation."
        />
      </div>
    );
  }

  if (isSignedOut) {
    return (
      <InvitationPanel
        eyebrow="Workspace invitation"
        heading="Taking you to sign in"
        body="Sign in with the email where you received this invitation, and Atlas will finish joining you to the workspace."
      />
    );
  }

  if (didFail || outcome?.status === ACCEPT_INVITATION_OUTCOME.UNAVAILABLE) {
    return (
      <InvitationPanel
        eyebrow="Workspace invitation"
        heading="This invitation can't be opened"
        body="It may have already been accepted, been canceled, or expired. Check your workspaces to see if you're already a member."
        action={{ label: "Review your workspaces", to: "/organization" }}
      />
    );
  }

  if (outcome?.status === ACCEPT_INVITATION_OUTCOME.WRONG_ACCOUNT) {
    return (
      <InvitationPanel
        eyebrow="Workspace invitation"
        heading="This invitation is for a different email"
        body="You're signed in with an account that doesn't match this invitation. Sign out and sign back in with the email where you received it."
        action={{ label: "Go to sign in", to: "/sign-in" }}
      />
    );
  }

  if (outcome?.status === ACCEPT_INVITATION_OUTCOME.ACCEPTED) {
    const workspaceName = outcome.workspaceName ?? "your workspace";
    return (
      <InvitationPanel
        eyebrow="Workspace invitation"
        heading={`You've joined ${workspaceName}`}
        body="Your invitation was accepted and the workspace is ready for you."
        action={{ label: "Open your workspace", to: "/organization" }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Spinner />
      <InvitationPanel
        eyebrow="Workspace invitation"
        heading="Joining your workspace"
        body="Atlas is accepting your invitation and getting your workspace ready."
      />
    </div>
  );
}
