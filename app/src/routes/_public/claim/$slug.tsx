import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access";
import { useAtprotoIdentities } from "@/domains/access/atproto-identities";
import {
  useInitiateClaim,
  useMyClaims,
  useVerifyClaimDomain,
  useVerifyClaimEmail,
} from "@/domains/catalog/hooks/use-claims";
import { loadEntryBySlugAny } from "@/domains/catalog/server/profiles/profile-loaders";
import { PageLayout } from "@rebuildingamerica/atlas-ui/layout/page-layout";
import { buildPageHead } from "@/platform/seo";
import {
  ClaimContextRail,
  ClaimHero,
  ClaimSubmissionPanel,
  PendingClaimPanel,
  SignedOutPanel,
  VerificationTokenPanel,
  VerifiedClaimPanel,
} from "./-claim-components";
import { clearClaimDraft, loadClaimDraft, saveClaimDraft, type ClaimDraft } from "./claim-draft";

const claimSearchSchema = z.object({
  from: z.string().optional(),
  token: z.string().optional(),
  atprotoIdentityId: z.string().optional(),
  atprotoError: z.string().optional(),
});

type ClaimSearch = z.infer<typeof claimSearchSchema>;

export const Route = createFileRoute("/_public/claim/$slug")({
  validateSearch: claimSearchSchema,
  loader: async ({ params }) => {
    const entry = await loadEntryBySlugAny({ data: { slug: params.slug } });
    return { entry };
  },
  head: ({ loaderData }) => {
    const entry = loaderData?.entry;
    if (!entry) return {};
    return buildPageHead({
      title: `Verify ${entry.name} | Atlas`,
      description: `Verify the Atlas profile for ${entry.name}.`,
      path: `/claim/${entry.slug}`,
      noindex: true,
    });
  },
  component: ClaimRoute,
});

function ClaimRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const { entry } = Route.useLoaderData();
  const sessionQuery = useAtlasSession();
  const isSignedIn = Boolean(sessionQuery.data);

  const initiate = useInitiateClaim();
  const verify = useVerifyClaimEmail();
  const verifyDomain = useVerifyClaimDomain();
  const claims = useMyClaims();
  const atprotoIdentities = useAtprotoIdentities();
  const [restoredDraft] = useState(() => loadClaimDraft(entry.slug));
  const [relationship, setRelationship] = useState(
    restoredDraft?.relationship ?? defaultRelationship(entry.type),
  );
  const [evidence, setEvidence] = useState(restoredDraft?.evidence ?? "");
  const [requestedChanges, setRequestedChanges] = useState(restoredDraft?.requestedChanges ?? "");
  const [preferredContactChannel, setPreferredContactChannel] = useState(
    restoredDraft?.preferredContactChannel ?? "",
  );
  const [privateNote, setPrivateNote] = useState(restoredDraft?.privateNote ?? "");
  const [atprotoIdentityId, setAtprotoIdentityId] = useState(
    search.atprotoIdentityId ?? restoredDraft?.atprotoIdentityId ?? "",
  );
  const [dnsDomain, setDnsDomain] = useState(restoredDraft?.dnsDomain ?? "");
  const [useActiveWorkspace, setUseActiveWorkspace] = useState(
    restoredDraft?.useActiveWorkspace ?? false,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(search.atprotoError ?? null);

  const myClaim = claims.data?.find((claim) => claim.entry_id === entry.id);
  const profilePath = `/profiles/${entry.type === "organization" ? "organizations" : "people"}/${entry.slug}`;
  const verificationToken = search.token;
  const isOrganization = entry.type === "organization";
  const activeWorkspaceName = sessionQuery.data?.workspace?.activeOrganization?.name ?? null;
  const canUseActiveWorkspace = activeWorkspaceName !== null;
  const selectedAtprotoIdentity = atprotoIdentities.data?.find(
    (identity) => identity.id === atprotoIdentityId,
  );
  const isResolvingAtprotoIdentity =
    Boolean(atprotoIdentityId) &&
    !atprotoIdentities.data &&
    !atprotoIdentities.isError &&
    (atprotoIdentities.isLoading || atprotoIdentities.isPending);
  const activeAtprotoIdentityId =
    selectedAtprotoIdentity?.control_status === "active" &&
    selectedAtprotoIdentity.resolution_status === "verified"
      ? selectedAtprotoIdentity.id
      : "";

  async function handleInitiate() {
    setErrorMessage(null);
    const domainProof = dnsDomain.trim();
    const workspaceProof = canUseActiveWorkspace && useActiveWorkspace;
    if (isResolvingAtprotoIdentity) {
      return;
    }
    if (atprotoIdentityId && !activeAtprotoIdentityId) {
      setErrorMessage("Reconnect this ATProto account or choose another identity.");
      return;
    }
    if (
      isOrganization &&
      activeAtprotoIdentityId &&
      isGenericAtprotoHandle(selectedAtprotoIdentity?.current_handle ?? "") &&
      !domainProof &&
      !workspaceProof
    ) {
      setErrorMessage(
        "Add the organization domain or use a workspace where you manage this organization.",
      );
      return;
    }
    try {
      await initiate.mutateAsync({
        slug: entry.slug,
        body: {
          relationship,
          evidence: evidence.trim() || undefined,
          requested_changes: requestedChanges.trim() || undefined,
          preferred_contact_channel: preferredContactChannel || undefined,
          private_note: privateNote.trim() || undefined,
          ...(activeAtprotoIdentityId ? { atproto_identity_id: activeAtprotoIdentityId } : {}),
          ...(domainProof ? { dns_domain: domainProof } : {}),
          ...(workspaceProof ? { use_active_workspace: true } : {}),
        },
      });
      clearClaimDraft(entry.slug);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not start verification.");
    }
  }

  async function handleVerify() {
    /* v8 ignore start -- the verify CTA only renders when verificationToken is set */
    if (!verificationToken) return;
    /* v8 ignore stop */
    setErrorMessage(null);
    try {
      await verify.mutateAsync({ token: verificationToken });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not verify token.");
    }
  }

  async function handleVerifyDomain(claimId: string) {
    setErrorMessage(null);
    try {
      await verifyDomain.mutateAsync({ slug: entry.slug, claimId });
      return true;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not verify DNS record.");
      return false;
    }
  }

  function handleConnectAtproto(handle: string) {
    saveClaimDraft(entry.slug, currentDraft());
    const startUrl = new URL("/api/atproto/oauth/start", window.location.origin);
    startUrl.searchParams.set("handle", handle);
    startUrl.searchParams.set("returnTo", `/claim/${entry.slug}`);
    window.location.assign(startUrl.toString());
  }

  function currentDraft(): ClaimDraft {
    return {
      atprotoIdentityId,
      dnsDomain,
      evidence,
      preferredContactChannel,
      privateNote,
      relationship,
      requestedChanges,
      useActiveWorkspace,
    };
  }

  function handleCancel() {
    clearClaimDraft(entry.slug);
    setRelationship(defaultRelationship(entry.type));
    setEvidence("");
    setRequestedChanges("");
    setPreferredContactChannel("");
    setPrivateNote("");
    setAtprotoIdentityId("");
    setDnsDomain("");
    setUseActiveWorkspace(false);
    setErrorMessage(null);
  }

  return (
    <PageLayout className="pt-0 pb-12">
      <div className="mx-auto max-w-6xl py-10 lg:py-12">
        <Link
          to={profilePath as "/profiles"}
          className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to profile
        </Link>

        <ClaimHero entry={entry} />

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
          <ClaimContextRail entry={entry} claim={myClaim} className="order-1 lg:order-2" />
          <main className="order-2 space-y-5 lg:order-1">
            {!isSignedIn ? (
              <SignedOutPanel slug={slug} redirectTo={claimRedirectPath(slug, search)} />
            ) : verificationToken && myClaim?.status !== "verified" ? (
              <VerificationTokenPanel
                isPending={verify.isPending}
                onVerify={() => {
                  void handleVerify();
                }}
              />
            ) : myClaim?.status === "verified" ? (
              <VerifiedClaimPanel entry={entry} profilePath={profilePath} />
            ) : myClaim?.status === "pending" ? (
              <PendingClaimPanel
                claim={myClaim}
                isVerifyingDomain={verifyDomain.isPending}
                onVerifyDomain={(claimId) => {
                  return handleVerifyDomain(claimId);
                }}
              />
            ) : (
              <ClaimSubmissionPanel
                relationship={relationship}
                evidence={evidence}
                requestedChanges={requestedChanges}
                preferredContactChannel={preferredContactChannel}
                privateNote={privateNote}
                atprotoIdentities={atprotoIdentities.data ?? []}
                atprotoIdentitiesError={atprotoIdentities.isError}
                isResolvingAtprotoIdentity={isResolvingAtprotoIdentity}
                selectedAtprotoIdentityId={atprotoIdentityId}
                dnsDomain={dnsDomain}
                activeWorkspaceName={activeWorkspaceName}
                useActiveWorkspace={canUseActiveWorkspace && useActiveWorkspace}
                showOrganizationProofs={isOrganization}
                isPending={initiate.isPending}
                onRelationshipChange={setRelationship}
                onEvidenceChange={setEvidence}
                onRequestedChangesChange={setRequestedChanges}
                onPreferredContactChannelChange={setPreferredContactChannel}
                onPrivateNoteChange={setPrivateNote}
                onAtprotoIdentityChange={setAtprotoIdentityId}
                onDnsDomainChange={setDnsDomain}
                onUseActiveWorkspaceChange={setUseActiveWorkspace}
                onConnectAtproto={handleConnectAtproto}
                onCancel={handleCancel}
                onSubmit={() => {
                  void handleInitiate();
                }}
              />
            )}

            {errorMessage ? (
              <p className="type-body-medium text-on-error-container" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </main>
        </div>
      </div>
    </PageLayout>
  );
}

function claimRedirectPath(slug: string, search: ClaimSearch): string {
  const params = new URLSearchParams();
  for (const key of ["from", "token", "atprotoIdentityId", "atprotoError"] as const) {
    const value = search[key];
    if (value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `/claim/${slug}?${query}` : `/claim/${slug}`;
}

function defaultRelationship(entryType: string): string {
  return entryType === "organization" ? "organization_representative" : "self";
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function isGenericAtprotoHandle(handle: string): boolean {
  return normalizeHandle(handle).endsWith(".bsky.social");
}
