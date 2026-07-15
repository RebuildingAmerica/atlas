import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  Contact,
  Eye,
  FileText,
  LockKeyhole,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/platform/ui/badge";
import { Button } from "@/platform/ui/button";
import { Select } from "@/platform/ui/select";
import type { ProfileClaimResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

export function ClaimHero({ entry }: { entry: Entry }) {
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

export function SignedOutPanel({ slug }: SignedOutPanelProps) {
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
          className="bg-primary text-on-primary type-label-large inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 font-semibold"
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

export function VerificationTokenPanel({ isPending, onVerify }: VerificationTokenPanelProps) {
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

export function VerifiedClaimPanel({ entry, profilePath }: VerifiedClaimPanelProps) {
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
            className="bg-primary text-on-primary type-label-large inline-flex items-center gap-2 rounded-full px-5 py-2 font-semibold"
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

export function PendingClaimPanel({ claim }: PendingClaimPanelProps) {
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

export function ClaimSubmissionPanel({
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
    tone === "success"
      ? "border-outline-variant bg-success-container border"
      : "bg-surface-container";

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
