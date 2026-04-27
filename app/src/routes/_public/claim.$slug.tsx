import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { useAtlasSession } from "@/domains/access";
import {
  useInitiateClaim,
  useMyClaims,
  useVerifyClaimEmail,
} from "@/domains/catalog/hooks/use-claims";
import { loadEntryBySlugAny } from "@/domains/catalog/server/profiles/profile-loaders";
import { PageLayout } from "@/platform/layout/page-layout";
import { Badge } from "@/platform/ui/badge";
import { Button } from "@/platform/ui/button";

const claimSearchSchema = z.object({
  from: z.string().optional(),
  token: z.string().optional(),
});

export const Route = createFileRoute("/_public/claim/$slug")({
  validateSearch: claimSearchSchema,
  loader: async ({ params }) => {
    const entry = await loadEntryBySlugAny({ data: { slug: params.slug } });
    return { entry };
  },
  head: ({ loaderData }) => {
    const entry = loaderData?.entry;
    if (!entry) return {};
    return {
      meta: [
        { title: `Claim ${entry.name} | Atlas` },
        {
          name: "description",
          content: `Verify and manage the Atlas profile for ${entry.name}.`,
        },
      ],
    };
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
  const claims = useMyClaims();
  const [evidence, setEvidence] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const myClaim = claims.data?.find((claim) => claim.entry_id === entry.id);
  const profilePath = `/profiles/${entry.type === "organization" ? "organizations" : "people"}/${entry.slug}`;
  const verificationToken = search.token;

  async function handleInitiate() {
    setErrorMessage(null);
    try {
      await initiate.mutateAsync({
        slug: entry.slug,
        body: { evidence: evidence.trim() || undefined },
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not initiate claim.");
    }
  }

  async function handleVerify() {
    if (!verificationToken) return;
    setErrorMessage(null);
    try {
      await verify.mutateAsync({ token: verificationToken });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not verify token.");
    }
  }

  return (
    <PageLayout className="pt-0 pb-12">
      <div className="mx-auto max-w-2xl space-y-8 py-12">
        <Link
          to={profilePath as "/profiles"}
          className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to profile
        </Link>

        <div className="space-y-3">
          <Badge variant="info">Claim a profile</Badge>
          <h1 className="type-display-small text-ink-strong">{entry.name}</h1>
          <p className="type-body-large text-ink-soft">
            Claim this profile to verify what Atlas surfaces about you and choose what stays
            visible. Atlas remains the source of record — claiming controls what readers see, not
            what we know.
          </p>
        </div>

        {!isSignedIn ? (
          <div className="bg-surface-container space-y-4 rounded-[1rem] p-6">
            <p className="type-body-medium text-ink-strong">
              You need an Atlas account to claim this profile.
            </p>
            <Link
              to="/sign-in"
              search={{
                redirect:
                  typeof window !== "undefined"
                    ? window.location.pathname + window.location.search
                    : `/claim/${slug}`,
              }}
              className="bg-primary type-label-large inline-flex items-center gap-2 rounded-full px-5 py-2 font-semibold text-white"
            >
              Sign in to continue
            </Link>
          </div>
        ) : verificationToken && myClaim?.status !== "verified" ? (
          <div className="bg-surface-container space-y-4 rounded-[1rem] p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="text-accent mt-1 h-5 w-5 shrink-0" aria-hidden />
              <div className="space-y-2">
                <h2 className="type-title-medium text-ink-strong">Verify your claim</h2>
                <p className="type-body-medium text-ink-soft">
                  Click the button below to confirm the verification token from your email and
                  finish claiming this profile.
                </p>
              </div>
            </div>
            <Button
              onClick={() => {
                void handleVerify();
              }}
              disabled={verify.isPending}
            >
              {verify.isPending ? "Verifying…" : "Confirm verification"}
            </Button>
          </div>
        ) : myClaim?.status === "verified" ? (
          <div className="space-y-4 rounded-[1rem] border border-emerald-200 bg-emerald-50/60 p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
              <div className="space-y-2">
                <h2 className="type-title-medium text-ink-strong">
                  You&apos;ve claimed this profile
                </h2>
                <p className="type-body-medium text-ink-soft">
                  Manage what&apos;s surfaced from your workspace any time.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/manage/$slug"
                params={{ slug: entry.slug }}
                className="bg-primary type-label-large inline-flex items-center gap-2 rounded-full px-5 py-2 font-semibold text-white"
              >
                Manage profile
              </Link>
              <Link
                to={profilePath as "/profiles"}
                className="type-label-large border-outline-variant bg-surface-container-lowest text-on-surface inline-flex items-center gap-2 rounded-full border px-5 py-2 font-medium"
              >
                View public profile
              </Link>
            </div>
          </div>
        ) : myClaim?.status === "pending" ? (
          <div className="bg-surface-container space-y-3 rounded-[1rem] p-6">
            <div className="flex items-start gap-3">
              <Clock className="text-ink-soft mt-1 h-5 w-5 shrink-0" aria-hidden />
              <div className="space-y-2">
                <h2 className="type-title-medium text-ink-strong">Claim under review</h2>
                <p className="type-body-medium text-ink-soft">
                  We&apos;ve received your{" "}
                  {myClaim.tier === 1 ? "tier-1 email verification" : "manual review"} claim and are
                  processing it. You&apos;ll receive an email once it&apos;s verified.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-surface-container space-y-4 rounded-[1rem] p-6">
            <p className="type-body-medium text-ink-strong">
              We&apos;ll match your account email against the contact details Atlas has for this
              profile. If they match, you&apos;ll get a verification email that confirms ownership.
              If not, share evidence below and a moderator will review your request.
            </p>
            <textarea
              className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
              rows={4}
              placeholder="Optional: link to a LinkedIn profile, official email, or other evidence that you control this identity."
              value={evidence}
              onChange={(event) => {
                setEvidence(event.target.value);
              }}
            />
            <Button
              onClick={() => {
                void handleInitiate();
              }}
              disabled={initiate.isPending}
            >
              {initiate.isPending ? "Submitting…" : "Submit claim"}
            </Button>
          </div>
        )}

        {errorMessage ? (
          <p className="type-body-medium text-rose-700" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </PageLayout>
  );
}
