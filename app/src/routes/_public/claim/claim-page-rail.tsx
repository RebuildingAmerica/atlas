import { Eye, FileText, Globe, LockKeyhole, Mail, MapPin, ShieldQuestion } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/platform/ui/badge";
import type { ProfileClaimResponse } from "@/lib/generated/atlas";
import type { Entry } from "@/types";
import {
  claimStatusLabel,
  entryTypeLabel,
  formatEntryLocation,
  safeSourceCount,
} from "./claim-page-utils";

interface ClaimContextRailProps {
  entry: Entry;
  claim?: ProfileClaimResponse;
  className?: string;
}

export function ClaimContextRail({ entry, claim, className }: ClaimContextRailProps) {
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
