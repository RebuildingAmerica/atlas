import { useState } from "react";
import { useAtlasSession } from "@/domains/access";
import {
  useInitiateClaim,
  useMyClaims,
  useVerifyClaimEmail,
} from "@/domains/catalog/hooks/use-claims";
import { PageLayout } from "@/platform/layout/page-layout";
import type { Entry } from "@/types";
import {
  ClaimHero,
  ClaimSubmissionPanel,
  PendingClaimPanel,
  SignedOutPanel,
  VerificationTokenPanel,
  VerifiedClaimPanel,
} from "./claim-page-panels";
import { ClaimContextRail } from "./claim-page-rail";

interface ClaimPageSearch {
  token?: string;
  from?: string;
}

interface ClaimPageProps {
  slug: string;
  entry: Entry;
  search: ClaimPageSearch;
}

export function ClaimPage({ slug, entry, search }: ClaimPageProps) {
  const sessionQuery = useAtlasSession();
  const isSignedIn = Boolean(sessionQuery.data);

  const initiate = useInitiateClaim();
  const verify = useVerifyClaimEmail();
  const claims = useMyClaims();
  const [relationship, setRelationship] = useState("self");
  const [evidence, setEvidence] = useState("");
  const [requestedChanges, setRequestedChanges] = useState("");
  const [preferredContactChannel, setPreferredContactChannel] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const myClaim = claims.data?.find((claim) => claim.entry_id === entry.id);
  const profilePath = `/profiles/${entry.type === "organization" ? "organizations" : "people"}/${entry.slug}`;
  const verificationToken = search.token;

  async function handleInitiate() {
    setErrorMessage(null);
    try {
      await initiate.mutateAsync({
        slug: entry.slug,
        body: {
          relationship,
          evidence: evidence.trim() || undefined,
          requested_changes: requestedChanges.trim() || undefined,
          preferred_contact_channel: preferredContactChannel || undefined,
          private_note: privateNote.trim() || undefined,
        },
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not initiate claim.");
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

  return (
    <PageLayout className="pt-0 pb-12">
      <div className="mx-auto max-w-6xl py-10 lg:py-12">
        <ClaimHero entry={entry} />

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
          <ClaimContextRail entry={entry} claim={myClaim} className="order-1 lg:order-2" />
          <main className="order-2 space-y-5 lg:order-1">
            {!isSignedIn ? (
              <SignedOutPanel slug={slug} />
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
              <PendingClaimPanel claim={myClaim} />
            ) : (
              <ClaimSubmissionPanel
                relationship={relationship}
                evidence={evidence}
                requestedChanges={requestedChanges}
                preferredContactChannel={preferredContactChannel}
                privateNote={privateNote}
                isPending={initiate.isPending}
                onRelationshipChange={setRelationship}
                onEvidenceChange={setEvidence}
                onRequestedChangesChange={setRequestedChanges}
                onPreferredContactChannelChange={setPreferredContactChannel}
                onPrivateNoteChange={setPrivateNote}
                onSubmit={() => {
                  void handleInitiate();
                }}
              />
            )}

            {errorMessage ? (
              <p className="type-body-medium text-rose-700" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </main>
        </div>
      </div>
    </PageLayout>
  );
}
