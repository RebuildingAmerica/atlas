import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Contact,
  Eye,
  FileText,
  Globe,
  LockKeyhole,
  Mail,
  MapPin,
  ShieldCheck,
  ShieldQuestion,
  UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
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
import { buildPageHead } from "@/platform/seo";
import type { ProfileClaimResponse } from "@/lib/generated/atlas";
import { Badge } from "@/platform/ui/badge";
import { Button } from "@/platform/ui/button";
import { Select } from "@/platform/ui/select";
import type { Entry } from "@/types";

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
    return buildPageHead({
      title: `Claim ${entry.name} | Atlas`,
      description: `Verify and manage the Atlas profile for ${entry.name}.`,
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

interface ClaimHeroProps {
  entry: Entry;
}

function ClaimHero({ entry }: ClaimHeroProps) {
  return (
    <header className="mt-8 max-w-3xl space-y-3">
      <Badge variant="info">Profile claim</Badge>
      <h1 className="type-display-small text-ink-strong">{entry.name}</h1>
      <p className="type-body-large text-ink-soft max-w-2xl">
        Use this when the profile is about you or an organization you can represent. Verified
        subjects can suggest corrections, choose a contact preference, and keep sensitive details
        out of public view.
      </p>
    </header>
  );
}

interface SignedOutPanelProps {
  slug: string;
}

function SignedOutPanel({ slug }: SignedOutPanelProps) {
  return (
    <ClaimPanel>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl space-y-2">
          <p className="type-label-small text-ink-muted uppercase">Account required</p>
          <h2 className="type-title-large text-ink-strong">Sign in to claim this profile</h2>
          <p className="type-body-medium text-ink-soft">
            Sign in with an account you control so the claim can be tied to a real subject or
            representative.
          </p>
        </div>
        <Link
          to="/sign-in"
          search={{
            redirect:
              /* v8 ignore next 3 -- the SSR-side fallback runs only when window is undefined; the route component is client-only */
              typeof window !== "undefined"
                ? window.location.pathname + window.location.search
                : `/claim/${slug}`,
          }}
          className="bg-primary type-label-large inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 font-semibold text-white"
        >
          Sign in to continue
        </Link>
      </div>
    </ClaimPanel>
  );
}

interface VerificationTokenPanelProps {
  isPending: boolean;
  onVerify: () => void;
}

function VerificationTokenPanel({ isPending, onVerify }: VerificationTokenPanelProps) {
  return (
    <ClaimPanel>
      <StateBlock icon={ShieldCheck} title="Verify your claim">
        <p className="type-body-medium text-ink-soft">
          Confirm the link sent to your email to finish this claim.
        </p>
        <Button onClick={onVerify} disabled={isPending}>
          {isPending ? "Verifying…" : "Confirm verification"}
        </Button>
      </StateBlock>
    </ClaimPanel>
  );
}

interface VerifiedClaimPanelProps {
  entry: Entry;
  profilePath: string;
}

function VerifiedClaimPanel({ entry, profilePath }: VerifiedClaimPanelProps) {
  return (
    <ClaimPanel tone="success">
      <StateBlock icon={CheckCircle2} title="You've claimed this profile">
        <p className="type-body-medium text-ink-soft">
          You can update public fields and source visibility from your workspace.
        </p>
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
      </StateBlock>
    </ClaimPanel>
  );
}

interface PendingClaimPanelProps {
  claim: ProfileClaimResponse;
}

function PendingClaimPanel({ claim }: PendingClaimPanelProps) {
  return (
    <ClaimPanel>
      <StateBlock icon={Clock} title="Claim under review">
        <p className="type-body-medium text-ink-soft">
          Your {claim.tier === 1 ? "tier-1 email verification" : "manual review"} claim is pending.
          You&apos;ll receive an email once it&apos;s verified.
        </p>
      </StateBlock>
    </ClaimPanel>
  );
}

interface ClaimSubmissionPanelProps {
  relationship: string;
  evidence: string;
  requestedChanges: string;
  preferredContactChannel: string;
  privateNote: string;
  isPending: boolean;
  onRelationshipChange: (value: string) => void;
  onEvidenceChange: (value: string) => void;
  onRequestedChangesChange: (value: string) => void;
  onPreferredContactChannelChange: (value: string) => void;
  onPrivateNoteChange: (value: string) => void;
  onSubmit: () => void;
}

function ClaimSubmissionPanel({
  relationship,
  evidence,
  requestedChanges,
  preferredContactChannel,
  privateNote,
  isPending,
  onRelationshipChange,
  onEvidenceChange,
  onRequestedChangesChange,
  onPreferredContactChannelChange,
  onPrivateNoteChange,
  onSubmit,
}: ClaimSubmissionPanelProps) {
  return (
    <div className="space-y-5">
      <StepSection
        number="1"
        title="Verify relationship"
        description="Start with the link between you and this profile."
      >
        <Select
          ariaLabel="Your relationship to this profile"
          icon={UserCheck}
          value={relationship}
          onChange={onRelationshipChange}
          options={[
            { value: "self", label: "This is me" },
            { value: "organization_representative", label: "I represent this organization" },
            { value: "staff", label: "I work with this person or organization" },
          ]}
          size="compact"
        />
        <FieldBlock
          label="Evidence for this claim"
          help="Official site, staff page, organization email, public byline, or another source that connects you to this profile."
          htmlFor="claim-evidence"
        >
          <textarea
            id="claim-evidence"
            aria-describedby="claim-evidence-help"
            className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
            rows={4}
            value={evidence}
            onChange={(event) => {
              onEvidenceChange(event.target.value);
            }}
          />
        </FieldBlock>
      </StepSection>

      <StepSection
        number="2"
        title="Suggest public changes"
        description="Tell reviewers what should change on the public profile."
      >
        <FieldBlock
          label="What should change?"
          help="Name, role, bio, location, contact preference, or source visibility."
          htmlFor="claim-requested-changes"
        >
          <textarea
            id="claim-requested-changes"
            aria-describedby="claim-requested-changes-help"
            className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
            rows={4}
            value={requestedChanges}
            onChange={(event) => {
              onRequestedChangesChange(event.target.value);
            }}
          />
        </FieldBlock>
        <Select
          ariaLabel="Preferred contact"
          icon={Contact}
          value={preferredContactChannel}
          onChange={onPreferredContactChannelChange}
          options={[
            { value: "", label: "No preference" },
            { value: "email", label: "Email" },
            { value: "form", label: "Contact form" },
            { value: "external", label: "External link" },
          ]}
          size="compact"
        />
      </StepSection>

      <StepSection
        number="3"
        title="Private context"
        description="Add anything reviewers should know but readers should not see."
      >
        <FieldBlock
          label="Private note"
          help="For reviewers only. Do not put public profile copy here."
          htmlFor="claim-private-note"
          icon={LockKeyhole}
        >
          <textarea
            id="claim-private-note"
            aria-describedby="claim-private-note-help"
            className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
            rows={3}
            value={privateNote}
            onChange={(event) => {
              onPrivateNoteChange(event.target.value);
            }}
          />
        </FieldBlock>

        <section className="border-outline-variant bg-surface-container-lowest rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Eye className="text-ink-muted h-4 w-4" aria-hidden />
            <h3 className="type-title-small text-ink-strong">Public after verification</h3>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3">
            <ClaimVisibilityItem
              icon={FileText}
              title="Profile fields"
              description="Bio, photo, role, and location."
            />
            <ClaimVisibilityItem
              icon={Contact}
              title="Contact preference"
              description="How people should reach you."
            />
            <ClaimVisibilityItem
              icon={ShieldCheck}
              title="Source visibility"
              description="Which sources appear publicly."
            />
          </ul>
        </section>

        <div className="border-outline-variant flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-body-small text-ink-soft max-w-md">
            Submit when the relationship and requested changes are clear enough for review.
          </p>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? "Submitting…" : "Submit claim"}
          </Button>
        </div>
      </StepSection>
    </div>
  );
}

interface StepSectionProps {
  number: string;
  title: string;
  description: string;
  children: ReactNode;
}

function StepSection({ number, title, description, children }: StepSectionProps) {
  return (
    <section className="bg-surface-container grid gap-5 rounded-[1rem] p-5 sm:grid-cols-[3rem_minmax(0,1fr)] sm:p-6">
      <div className="border-outline-variant bg-surface-container-lowest text-ink-strong flex h-9 w-9 items-center justify-center rounded-full border font-semibold">
        {number}
      </div>
      <div className="min-w-0 space-y-4">
        <div className="space-y-1">
          <h2 className="type-title-medium text-ink-strong">{title}</h2>
          <p className="type-body-medium text-ink-soft">{description}</p>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </section>
  );
}

interface ClaimPanelProps {
  children: ReactNode;
  tone?: "default" | "success";
}

function ClaimPanel({ children, tone = "default" }: ClaimPanelProps) {
  const toneClass =
    tone === "success" ? "border border-emerald-200 bg-emerald-50/70" : "bg-surface-container";

  return <section className={`${toneClass} rounded-[1rem] p-6`}>{children}</section>;
}

interface FieldBlockProps {
  label: string;
  help: string;
  htmlFor: string;
  icon?: LucideIcon;
  children: ReactNode;
}

function FieldBlock({ label, help, htmlFor, icon: Icon, children }: FieldBlockProps) {
  const helpId = `${htmlFor}-help`;
  return (
    <div className="space-y-2">
      <label
        htmlFor={htmlFor}
        className="type-label-medium text-ink-strong flex items-center gap-2"
      >
        {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
        {label}
      </label>
      {children}
      <p id={helpId} className="type-body-small text-ink-soft">
        {help}
      </p>
    </div>
  );
}

interface StateBlockProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}

function StateBlock({ icon: Icon, title, children }: StateBlockProps) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="text-accent mt-1 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-3">
        <h2 className="type-title-medium text-ink-strong">{title}</h2>
        {children}
      </div>
    </div>
  );
}

interface ClaimContextRailProps {
  entry: Entry;
  claim?: ProfileClaimResponse;
  className?: string;
}

function ClaimContextRail({ entry, claim, className }: ClaimContextRailProps) {
  const location = formatEntryLocation(entry);
  const sourceCount = safeSourceCount(entry);
  const verification = claimStatusLabel(entry, claim);

  return (
    <aside className={`space-y-4 lg:sticky lg:top-28 ${className ?? ""}`}>
      <RailPanel title="Profile being claimed">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="type-title-medium text-ink-strong">{entry.name}</p>
            <div className="flex flex-wrap gap-2">
              <Badge>{entryTypeLabel(entry.type)}</Badge>
              <Badge variant={verification.variant}>{verification.label}</Badge>
            </div>
          </div>

          <dl className="space-y-2">
            {location ? <RailFact icon={MapPin} label="Place" value={location} /> : null}
            <RailFact
              icon={FileText}
              label="Sources"
              value={`${sourceCount} ${sourceCount === 1 ? "source packet" : "source packets"}`}
            />
            {entry.website ? <RailFact icon={Globe} label="Website" value={entry.website} /> : null}
            {entry.email ? <RailFact icon={Mail} label="Email" value={entry.email} /> : null}
          </dl>
        </div>
      </RailPanel>

      <RailPanel title="What happens next">
        <div className="space-y-3">
          <RailStep icon={Mail} title="Email match">
            If your account email matches public contact details, the claim can use email
            verification.
          </RailStep>
          <RailStep icon={ShieldQuestion} title="Manual review">
            If it does not match, reviewers use your evidence and notes to evaluate the claim.
          </RailStep>
        </div>
      </RailPanel>

      <RailPanel title="Public vs private">
        <div className="grid gap-2">
          <VisibilityRow icon={Eye} label="Public" value="Profile fields and contact preference." />
          <VisibilityRow
            icon={LockKeyhole}
            label="Private"
            value="Reviewer note and claim proof."
          />
        </div>
      </RailPanel>
    </aside>
  );
}

interface RailPanelProps {
  title: string;
  children: ReactNode;
}

function RailPanel({ title, children }: RailPanelProps) {
  return (
    <section className="border-outline-variant bg-surface-container-lowest rounded-[1rem] border p-4">
      <h2 className="type-title-small text-ink-strong mb-3">{title}</h2>
      {children}
    </section>
  );
}

interface RailFactProps {
  icon: LucideIcon;
  label: string;
  value: string;
}

function RailFact({ icon: Icon, label, value }: RailFactProps) {
  return (
    <div className="flex gap-2">
      <Icon className="text-ink-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <dt className="type-label-small text-ink-muted">{label}</dt>
        <dd className="type-body-small text-ink-strong break-words">{value}</dd>
      </div>
    </div>
  );
}

interface RailStepProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}

function RailStep({ icon: Icon, title, children }: RailStepProps) {
  return (
    <div className="flex gap-2">
      <Icon className="text-ink-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-0.5">
        <p className="type-label-medium text-ink-strong">{title}</p>
        <p className="type-body-small text-ink-soft">{children}</p>
      </div>
    </div>
  );
}

interface VisibilityRowProps {
  icon: LucideIcon;
  label: string;
  value: string;
}

function VisibilityRow({ icon: Icon, label, value }: VisibilityRowProps) {
  return (
    <div className="bg-surface-container rounded-lg p-3">
      <div className="flex items-center gap-2">
        <Icon className="text-ink-muted h-4 w-4" aria-hidden />
        <p className="type-label-medium text-ink-strong">{label}</p>
      </div>
      <p className="type-body-small text-ink-soft mt-1">{value}</p>
    </div>
  );
}

interface ClaimVisibilityItemProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

function ClaimVisibilityItem({ icon: Icon, title, description }: ClaimVisibilityItemProps) {
  return (
    <li className="space-y-1">
      <Icon className="text-ink-muted h-4 w-4" aria-hidden />
      <p className="type-label-medium text-ink-strong">{title}</p>
      <p className="type-body-small text-ink-soft">{description}</p>
    </li>
  );
}

function safeSourceCount(entry: Entry): number {
  return typeof entry.source_count === "number" ? entry.source_count : 0;
}

function formatEntryLocation(entry: Entry): string | null {
  const parts = [entry.city, entry.state, entry.region].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(", ");
  }
  return entry.full_address ?? null;
}

function entryTypeLabel(type: Entry["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function claimStatusLabel(
  entry: Entry,
  claim?: ProfileClaimResponse,
): { label: string; variant: "default" | "success" | "warning" | "info" } {
  if (claim?.status === "verified" || entry.claim?.status === "verified") {
    return { label: "Subject verified", variant: "success" };
  }
  if (claim?.status === "pending" || entry.claim?.status === "pending") {
    return { label: "Under review", variant: "warning" };
  }
  if (entry.trust?.level === "atlas_verified") {
    return { label: "Atlas verified", variant: "info" };
  }
  if (entry.trust?.level === "corroborated") {
    return { label: "Corroborated", variant: "info" };
  }
  return { label: "Source linked", variant: "default" };
}
