import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, KeyRound, LogOut, Mail, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/platform/ui/button";
import { getAuthClient } from "@/domains/access/client/auth-client";
import { waitForAtlasPasskeyRegistration } from "@/domains/access/client/session-confirmation";
import { atlasSessionQueryKey, useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { createWorkspace } from "@/domains/access/organizations.functions";
import { resolvePasskeyName } from "@/domains/access/passkey-names";
import { updatePasskey } from "@/domains/access/passkeys.functions";
import { getRpLogoutRedirect, sendVerificationEmail } from "@/domains/access/session.functions";
import { describePasskeyError } from "@/domains/access/auth-errors";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";

interface AccountSetupPageProps {
  redirectTo?: string;
}

const AUTO_REPOLL_INTERVAL_MS = 15_000;

/**
 * Renders the relative time elapsed since `timestamp`, refreshing once per
 * second so the operator sees a live "Last checked: 5s ago" string instead
 * of a stale snapshot.
 */
function useRelativeTimestamp(timestamp: number | null): string | null {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  if (timestamp === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (elapsedSeconds < 5) {
    return "just now";
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  return `${minutes}m ago`;
}

/**
 * Builds the workspace slug Atlas uses when auto-creating the operator's
 * first solo workspace.
 */
function deriveSoloWorkspaceSlug(displayName: string | null | undefined): {
  name: string;
  slug: string;
} {
  const workspaceName = displayName ? `${displayName}'s Workspace` : "My Workspace";
  const workspaceSlug = workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { name: workspaceName, slug: workspaceSlug };
}

/**
 * Resolves the destination Atlas should navigate to once the operator's
 * required setup steps are done.  Hands pending-invitation operators to
 * /organization so they can accept; everyone else lands on the explicit
 * `redirectTo` (when supplied) or /discovery.
 */
function resolveReadyDestination(session: AtlasSessionPayload, redirectTo?: string): string {
  if (session.workspace.onboarding.hasPendingInvitations) {
    return "/organization";
  }
  return redirectTo ?? "/discovery";
}

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

  const checklist = useMemo(() => {
    const emailVerified = Boolean(session?.user.emailVerified);
    const hasPasskey = Boolean(session?.hasPasskey);
    return [
      {
        complete: emailVerified,
        description: emailVerified
          ? "Your email is verified."
          : "Verify your email to prove account ownership.",
        kind: "required" as const,
        title: "Verify your email",
      },
      {
        complete: hasPasskey,
        description: hasPasskey
          ? `You have ${session?.passkeyCount ?? 0} passkey${session?.passkeyCount === 1 ? "" : "s"} on this account.`
          : "Recommended — register a passkey so you can sign in instantly without an email link.",
        kind: "recommended" as const,
        title: "Register a passkey",
      },
    ];
  }, [session?.hasPasskey, session?.passkeyCount, session?.user.emailVerified]);

  const requiredCompleteCount = checklist.filter(
    (item) => item.kind === "required" && item.complete,
  ).length;
  const requiredTotal = checklist.filter((item) => item.kind === "required").length;
  const allComplete = checklist.every((item) => item.complete);

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
        <div className="border-border bg-surface-container-lowest flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border px-5 py-3">
          <div>
            <p className="type-label-medium text-ink-muted">Progress</p>
            <p className="type-title-small text-ink-strong">
              {requiredCompleteCount} of {requiredTotal} required step
              {requiredTotal === 1 ? "" : "s"} complete
              {allComplete ? " — passkey added too" : ""}
            </p>
          </div>
          {lastCheckedLabel ? (
            <p className="type-body-small text-ink-soft" aria-live="polite">
              Last checked {lastCheckedLabel}
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          {checklist.map((item) => (
            <article
              key={item.title}
              className="border-border rounded-[1.4rem] border bg-white/70 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="type-title-small text-ink-strong">{item.title}</p>
                    {item.kind === "recommended" ? (
                      <span className="type-label-small text-ink-soft border-border rounded-full border px-2 py-0.5">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="type-body-medium text-ink-soft">{item.description}</p>
                </div>
                <span
                  className={
                    item.complete
                      ? "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                      : "border-border text-ink-soft inline-flex items-center gap-1 rounded-full border px-3 py-1"
                  }
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {item.complete ? "Done" : item.kind === "recommended" ? "Optional" : "Pending"}
                </span>
              </div>
            </article>
          ))}
        </div>

        {!session.user.emailVerified ? (
          <div className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-5">
            <p className="type-title-small text-ink-strong">Verify your email</p>
            <p className="type-body-medium text-ink-soft mt-2">
              We&apos;ll send a verification link to {session.user.email}. After you open it, come
              back here — Atlas refreshes your status automatically.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                disabled={sendVerificationMutation.isPending}
                onClick={() => {
                  sendVerificationMutation.mutate();
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {sendVerificationMutation.isPending
                    ? "Sending verification..."
                    : "Send verification email"}
                </span>
              </Button>
              {sendVerificationMutation.isSuccess ? (
                <p className="type-body-medium text-ink-soft">Verification email sent.</p>
              ) : null}
              {sendVerificationMutation.isError ? (
                <p className="type-body-medium text-red-700">
                  Atlas could not send the verification email right now.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {!session.hasPasskey ? (
          <div
            className={
              session.user.emailVerified
                ? "rounded-[1.4rem] border-2 border-blue-300 bg-blue-50/50 p-5"
                : "border-border bg-surface-container-lowest rounded-[1.4rem] border p-5"
            }
          >
            <p className="type-title-small text-ink-strong">
              {session.user.emailVerified
                ? "Almost there — add a passkey or skip"
                : "Add a passkey"}
            </p>
            <p className="type-body-medium text-ink-soft mt-2">
              Passkeys let you sign in instantly with the same Touch ID, Face ID, Windows Hello, or
              hardware security key you already use elsewhere — no password to remember and no email
              link to wait on. You can also keep using magic links and add a passkey later.
            </p>
            <details className="mt-3">
              <summary className="type-label-medium text-accent cursor-pointer hover:underline">
                What's a passkey?
              </summary>
              <div className="type-body-small text-ink-soft mt-2 space-y-2 leading-relaxed">
                <p>
                  A passkey is a credential that lives on your device or hardware key. It uses your
                  fingerprint, face, or device PIN to authorize sign-in instead of typing anything.
                </p>
                <p>
                  Passkeys are phishing-resistant — they only work on the real Atlas origin — and
                  Atlas never sees the underlying biometric. Your device stores the secret half of
                  the credential; Atlas only stores the public half.
                </p>
                <p>
                  Most modern browsers and operating systems support passkeys: Safari/macOS, Chrome
                  and Edge on Windows, iOS, and Android. Hardware security keys (YubiKey, Titan,
                  etc.) work too.
                </p>
              </div>
            </details>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant={session.user.emailVerified ? "primary" : "secondary"}
                disabled={addPasskeyMutation.isPending}
                onClick={() => {
                  void handleAddPasskey();
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  {addPasskeyMutation.isPending ? "Adding passkey..." : "Add a passkey"}
                </span>
              </Button>
              {session.user.emailVerified ? (
                <Button
                  variant="secondary"
                  disabled={isContinuingWithoutPasskey}
                  onClick={() => {
                    void handleContinueWithoutPasskey();
                  }}
                >
                  <span className="inline-flex items-center gap-2">
                    {isContinuingWithoutPasskey ? "Continuing..." : "Continue without a passkey"}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </Button>
              ) : null}
              {addPasskeyMutation.isError ? (
                <p className="type-body-medium text-red-700">
                  {addPasskeyMutation.error instanceof Error
                    ? addPasskeyMutation.error.message
                    : "Atlas could not add that passkey right now."}
                </p>
              ) : null}
            </div>
            <p className="type-body-small text-ink-soft mt-3">
              You can add or replace a passkey anytime from your account settings.
            </p>
          </div>
        ) : null}
      </div>

      <div className="border-border bg-surface-container-lowest space-y-4 rounded-[1.4rem] border p-5">
        <div className="space-y-2">
          <p className="type-title-medium text-ink-strong">Next step</p>
          <p className="type-body-medium text-ink-soft">
            Atlas refreshes your status automatically. Use the button below if you'd like to check
            sooner.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={atlasSession.isRefetching}
            onClick={() => {
              void handleRefreshAndContinue();
            }}
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              {atlasSession.isRefetching ? "Refreshing..." : "Refresh status"}
            </span>
          </Button>

          <Button
            variant="ghost"
            disabled={signOutMutation.isPending}
            onClick={() => {
              signOutMutation.mutate();
            }}
          >
            <span className="inline-flex items-center gap-2">
              <LogOut className="h-4 w-4" />
              {signOutMutation.isPending ? "Signing out..." : "Sign out"}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
