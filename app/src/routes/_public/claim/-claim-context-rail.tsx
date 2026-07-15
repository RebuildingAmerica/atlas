import { Eye, FileText, Globe, LockKeyhole, Mail, MapPin, ShieldQuestion } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ProfileClaimResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import { Badge } from "@/platform/ui/badge";
import { SurfaceSection } from "@/platform/ui/surface-section";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

export interface ClaimContextRailProps {
  entry: Entry;
  claim?: ProfileClaimResponse;
  className?: string;
}

export function ClaimContextRail({ entry, claim, className }: ClaimContextRailProps) {
  const location = formatEntryLocation(entry);
  const sourceCount = safeSourceCount(entry);
  const verification = verificationBadge(entry, claim);

  return (
    <aside className={`space-y-4 lg:sticky lg:top-28 ${className ?? ""}`}>
      <SurfaceSection title="Profile being verified" tone="plain" className="p-4 sm:p-4">
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
              value={`${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`}
            />
            {entry.website ? <RailFact icon={Globe} label="Website" value={entry.website} /> : null}
            {entry.email ? <RailFact icon={Mail} label="Email" value={entry.email} /> : null}
          </dl>
        </div>
      </SurfaceSection>

      <SurfaceSection title="What happens next" tone="plain" className="p-4 sm:p-4">
        <div className="space-y-3">
          <RailStep icon={Mail} title="Matching email">
            If your account email matches this profile, email verification may be enough.
          </RailStep>
          <RailStep icon={ShieldQuestion} title="Review">
            Other sources are checked against the profile.
          </RailStep>
        </div>
      </SurfaceSection>

      <SurfaceSection title="Who sees what" tone="plain" className="p-4 sm:p-4">
        <div className="grid gap-2">
          <VisibilityRow
            icon={Eye}
            label="Shown to readers"
            value="Profile details and contact preference."
          />
          <VisibilityRow
            icon={LockKeyhole}
            label="Not shown"
            value="Your private note and sources."
          />
        </div>
      </SurfaceSection>
    </aside>
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

function verificationBadge(
  entry: Entry,
  claim?: ProfileClaimResponse,
): { label: string; variant: "default" | "success" | "warning" | "info" } {
  const status = claim?.status ?? entry.claim?.status;
  if (status === "verified") return { label: "Verified", variant: "success" };
  if (status === "pending") return { label: "Under review", variant: "warning" };
  return { label: "Source backed", variant: "default" };
}
