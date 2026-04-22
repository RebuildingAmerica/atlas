import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, LogOut, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { getAuthClient } from "../client/auth-client";
import { atlasSessionQueryKey, useAtlasSession } from "../client/use-atlas-session";
import { waitForAtlasPasskeyRegistration } from "../client/session-confirmation";
import { createWorkspace } from "../organizations.functions";
import { resolvePasskeyName } from "../passkey-names";
import { updatePasskey } from "../passkeys.functions";
import { sendVerificationEmail } from "../session.functions";

interface AccountSetupPageProps {
  redirectTo?: string;
}

/**
 * Completion-only setup experience for signed-in operators who still need to
 * verify their email or register a passkey before Atlas grants resource-
 * creation access.
 */
export function AccountSetupPage({ redirectTo }: AccountSetupPageProps) {
  const queryClient = useQueryClient();
  const atlasSession = useAtlasSession();
  const session = atlasSession.data;

  const refreshReadiness = async () => {
    await queryClient.invalidateQueries({ queryKey: atlasSessionQueryKey });
    return await atlasSession.refetch();
  };

  const sendVerificationMutation = useMutation({
    mutationFn: () => sendVerificationEmail(),
  });

  const addPasskeyMutation = useMutation({
    mutationFn: async () => {
      const result = await getAuthClient().passkey.addPasskey({});

      if (result.error) {
        throw new Error(result.error.message || "Atlas could not add that passkey.");
      }

      if (result.data) {
        const name = resolvePasskeyName(result.data.aaguid);
        await updatePasskey({ data: { id: result.data.id, name } });
      }
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      await getAuthClient().signOut();
      window.location.assign("/");
    },
  });

  const handleRefresh = async () => {
    const refreshedSession = await refreshReadiness();
    if (!refreshedSession.data?.accountReady) {
      return;
    }

    const refreshedNeedsWorkspace = refreshedSession.data.workspace.onboarding.needsWorkspace;
    const refreshedHasPendingInvitations =
      refreshedSession.data.workspace.onboarding.hasPendingInvitations;

    if (refreshedNeedsWorkspace && !refreshedHasPendingInvitations) {
      const displayName = refreshedSession.data.user.name;
      const workspaceName = displayName ? `${displayName}'s Workspace` : "My Workspace";
      const workspaceSlug = workspaceName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      await createWorkspace({
        data: {
          name: workspaceName,
          slug: workspaceSlug,
          workspaceType: "individual",
        },
      });
    }

    const resolvedDestination = refreshedHasPendingInvitations
      ? "/organization"
      : redirectTo || "/discovery";

    window.location.assign(resolvedDestination);
  };

  const handleAddPasskey = async () => {
    await addPasskeyMutation.mutateAsync();
    await waitForAtlasPasskeyRegistration();
    await handleRefresh();
  };

  const checklist = [
    {
      complete: Boolean(session?.user.emailVerified),
      description: session?.user.emailVerified
        ? "Your email is verified."
        : "Verify your email to prove account ownership.",
      title: "Verified email",
    },
    {
      complete: Boolean(session?.hasPasskey),
      description: session?.hasPasskey
        ? `You have ${session?.passkeyCount ?? 0} passkey${session?.passkeyCount === 1 ? "" : "s"} on this account.`
        : "Add a passkey so you can sign in instantly and securely — no passwords, no codes.",
      title: "Registered passkey",
    },
  ];

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
          Verify your email and add a passkey to finish setting up your account.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-3">
          {checklist.map((item) => (
            <article
              key={item.title}
              className="border-border rounded-[1.4rem] border bg-white/70 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="type-title-small text-ink-strong">{item.title}</p>
                  <p className="type-body-medium text-ink-soft">{item.description}</p>
                </div>
                <span
                  className={
                    item.complete
                      ? "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                      : "border-border text-ink-soft inline-flex items-center gap-1 rounded-full border px-3 py-1"
                  }
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {item.complete ? "Done" : "Pending"}
                </span>
              </div>
            </article>
          ))}
        </div>

        {!session?.user.emailVerified ? (
          <div className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-5">
            <p className="type-title-small text-ink-strong">Verify your email</p>
            <p className="type-body-medium text-ink-soft mt-2">
              We&apos;ll send a verification link to {session?.user.email}. After you open it, come
              back here and refresh your status.
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

        {!session?.hasPasskey ? (
          <div className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-5">
            <p className="type-title-small text-ink-strong">Add a passkey</p>
            <p className="type-body-medium text-ink-soft mt-2">
              Register a passkey on this device or with a hardware key. Passkeys are faster and more
              secure than passwords or email links.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                disabled={addPasskeyMutation.isPending}
                onClick={() => {
                  void handleAddPasskey();
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  {addPasskeyMutation.isPending ? "Adding passkey..." : "Add passkey"}
                </span>
              </Button>
              {addPasskeyMutation.isError ? (
                <p className="type-body-medium text-red-700">
                  {addPasskeyMutation.error instanceof Error
                    ? addPasskeyMutation.error.message
                    : "Atlas could not add that passkey right now."}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-border bg-surface-container-lowest space-y-4 rounded-[1.4rem] border p-5">
        <div className="space-y-2">
          <p className="type-title-medium text-ink-strong">Next step</p>
          <p className="type-body-medium text-ink-soft">
            Refresh your status after each step. Once both are done, you&apos;re in.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={atlasSession.isRefetching}
            onClick={() => {
              void handleRefresh();
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
