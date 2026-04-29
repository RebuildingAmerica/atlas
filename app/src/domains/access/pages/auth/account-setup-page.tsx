import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { waitForAtlasPasskeyRegistration } from "@/domains/access/client/session-confirmation";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { createWorkspace } from "@/domains/access/organizations.functions";
import { resolvePasskeyName } from "@/domains/access/passkey-names";
import { updatePasskey } from "@/domains/access/passkeys.functions";
import { getRpLogoutRedirect, sendVerificationEmail } from "@/domains/access/session.functions";
import { describePasskeyError } from "@/domains/access/auth-errors";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";
import {
  deriveSoloWorkspaceSlug,
  resolveReadyDestination,
  useRelativeTimestamp,
} from "./account-setup-helpers";
import {
  AccountSetupChecklist,
  type AccountSetupChecklistItem,
} from "./components/account-setup-checklist";
import { AccountSetupEmailCard } from "./components/account-setup-email-card";
import { AccountSetupNextStepCard } from "./components/account-setup-next-step-card";
import { AccountSetupPasskeyCard } from "./components/account-setup-passkey-card";

interface AccountSetupPageProps {
  redirectTo?: string;
}

const AUTO_REPOLL_INTERVAL_MS = 15_000;

/**
 * Completion-only setup experience for signed-in operators who still need to
 * verify their email or register a passkey before Atlas grants resource-
 * creation access.
 *
 * Email verification is required.  Passkey registration is recommended but
 * optional: the page surfaces a "Continue without a passkey" escape hatch
 * for operators who can't or won't enroll WebAuthn on their current device.
 *
 * @param props - Component props.
 * @param props.redirectTo - Optional post-setup destination forwarded from
 *   the originating route guard.
 */
export function AccountSetupPage({ redirectTo }: AccountSetupPageProps) {
  const queryClient = useQueryClient();
  const atlasSession = useAtlasSession();
  const session = atlasSession.data;
  const hasAutoRefreshedRef = useRef(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [isContinuingWithoutPasskey, setIsContinuingWithoutPasskey] = useState(false);
  const lastCheckedLabel = useRelativeTimestamp(lastCheckedAt);

  const sendVerificationMutation = useMutation({
    mutationFn: () => sendVerificationEmail(),
  });

  const addPasskeyMutation = useMutation({
    mutationFn: async () => {
      const result = await getAuthClient().passkey.addPasskey({});

      if (result.error) {
        throw new Error(describePasskeyError(result.error.message));
      }

      if (result.data) {
        const name = resolvePasskeyName(result.data.aaguid);
        await updatePasskey({ data: { id: result.data.id, name } });
      }
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const rpLogout = await getRpLogoutRedirect();
      await getAuthClient().signOut();
      window.location.assign(rpLogout.url ?? "/");
    },
  });

  const ensureSoloWorkspaceForReadySession = useCallback(
    async (readySession: AtlasSessionPayload) => {
      const { onboarding } = readySession.workspace;
      if (!onboarding.needsWorkspace || onboarding.hasPendingInvitations) {
        return;
      }
      const { name, slug } = deriveSoloWorkspaceSlug(readySession.user.name);
      await createWorkspace({
        data: { name, slug, workspaceType: "individual" },
      });
    },
    [],
  );

  const refreshStatus = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: atlasSessionQueryKey });
    const refreshed = await atlasSession.refetch();
    setLastCheckedAt(Date.now());
    return refreshed?.data ?? null;
  }, [atlasSession, queryClient]);

  const handleRefreshAndContinue = useCallback(async () => {
    const refreshed = await refreshStatus();
    if (!refreshed?.accountReady || !refreshed.hasPasskey) {
      return;
    }
    await ensureSoloWorkspaceForReadySession(refreshed);
    window.location.assign(resolveReadyDestination(refreshed, redirectTo));
  }, [ensureSoloWorkspaceForReadySession, redirectTo, refreshStatus]);

  // Auto-refresh on mount to pick up verification completed in another tab.
  useEffect(() => {
    if (hasAutoRefreshedRef.current) {
      return;
    }
    hasAutoRefreshedRef.current = true;
    void handleRefreshAndContinue();
  }, [handleRefreshAndContinue]);

  // Auto-refresh when the user returns to this tab after clicking a
  // verification email link.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void handleRefreshAndContinue();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [handleRefreshAndContinue]);

  // Periodic auto-poll so the checklist stays current even when the operator
  // never leaves and returns to the tab — for instance, while they click
  // the verification link in a desktop mail client that opens a new window
  // alongside this one rather than stealing focus.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void handleRefreshAndContinue();
    }, AUTO_REPOLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [handleRefreshAndContinue]);

  const handleAddPasskey = async () => {
    await addPasskeyMutation.mutateAsync();
    await waitForAtlasPasskeyRegistration();
    await handleRefreshAndContinue();
  };

  const handleContinueWithoutPasskey = async () => {
    if (!session) {
      return;
    }
    setIsContinuingWithoutPasskey(true);
    try {
      const refreshed = await refreshStatus();
      const target = refreshed ?? session;
      if (!target.accountReady) {
        return;
      }
      await ensureSoloWorkspaceForReadySession(target);
      window.location.assign(resolveReadyDestination(target, redirectTo));
    } finally {
      setIsContinuingWithoutPasskey(false);
    }
  };

  const checklist = useMemo<readonly AccountSetupChecklistItem[]>(() => {
    const emailVerified = Boolean(session?.user.emailVerified);
    const hasPasskey = Boolean(session?.hasPasskey);
    return [
      {
        complete: emailVerified,
        description: emailVerified
          ? "Your email is verified."
          : "Verify your email to prove account ownership.",
        kind: "required",
        title: "Verify your email",
      },
      {
        complete: hasPasskey,
        description: hasPasskey
          ? `You have ${session?.passkeyCount ?? 0} passkey${session?.passkeyCount === 1 ? "" : "s"} on this account.`
          : "Recommended — register a passkey so you can sign in instantly without an email link.",
        kind: "recommended",
        title: "Register a passkey",
      },
    ];
  }, [session?.hasPasskey, session?.passkeyCount, session?.user.emailVerified]);

  if (atlasSession.isPending || !session) {
    return (
      <div className="space-y-3">
        <p className="type-title-large text-ink-strong">Loading account setup...</p>
        <p className="type-body-medium text-ink-soft">
          Checking your email verification and passkey status.
        </p>
      </div>
    );
  }

  const passkeyErrorMessage = addPasskeyMutation.isError
    ? addPasskeyMutation.error instanceof Error
      ? addPasskeyMutation.error.message
      : "Atlas could not add that passkey right now."
    : null;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="type-label-medium text-ink-muted">Account setup</p>
        <h1 className="type-display-small text-ink-strong">Finish securing your Atlas account</h1>
        <p className="type-body-large text-ink-soft">
          Verify your email, then add a passkey if you'd like instant sign-in next time.
        </p>
      </div>

      <div className="space-y-4">
        <AccountSetupChecklist checklist={checklist} lastCheckedLabel={lastCheckedLabel} />

        {!session.user.emailVerified ? (
          <AccountSetupEmailCard
            email={session.user.email}
            isError={sendVerificationMutation.isError}
            isPending={sendVerificationMutation.isPending}
            isSent={sendVerificationMutation.isSuccess}
            onSend={() => {
              sendVerificationMutation.mutate();
            }}
          />
        ) : null}

        {!session.hasPasskey ? (
          <AccountSetupPasskeyCard
            emailVerified={session.user.emailVerified}
            errorMessage={passkeyErrorMessage}
            isAddPending={addPasskeyMutation.isPending}
            isContinuingWithoutPasskey={isContinuingWithoutPasskey}
            onAddPasskey={() => {
              void handleAddPasskey();
            }}
            onContinueWithoutPasskey={() => {
              void handleContinueWithoutPasskey();
            }}
          />
        ) : null}
      </div>

      <AccountSetupNextStepCard
        isRefreshing={atlasSession.isRefetching}
        isSignOutPending={signOutMutation.isPending}
        onRefresh={() => {
          void handleRefreshAndContinue();
        }}
        onSignOut={() => {
          signOutMutation.mutate();
        }}
      />
    </div>
  );
}
