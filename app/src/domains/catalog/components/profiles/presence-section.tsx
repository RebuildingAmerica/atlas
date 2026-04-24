import { ArrowRight, Calendar, Globe, Mail, Phone } from "lucide-react";
import type { ReactNode } from "react";

interface PresenceSectionProps {
  website?: string;
  email?: string;
  phone?: string;
  firstSeen?: string;
}

interface ContactCellProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}

function formatPresenceDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function ContactCell({ icon, label, value }: ContactCellProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-surface-container flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="type-label-medium text-ink-muted">{label}</p>
        <div className="type-body-medium text-ink-strong leading-snug break-words">{value}</div>
      </div>
    </div>
  );
}

export function PresenceSection({ website, email, phone, firstSeen }: PresenceSectionProps) {
  const hasAny = website || email || phone || firstSeen;
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      <p className="type-label-medium text-ink-muted">Presence</p>

      {website ? (
        <a
          href={website}
          target="_blank"
          rel="noreferrer"
          className="bg-surface-container-lowest hover:bg-surface-container-low flex items-center gap-3 rounded-2xl p-4 transition-colors"
        >
          <div className="bg-ink-strong flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <Globe className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="type-title-small text-ink-strong">{extractDomain(website)}</p>
            <p className="type-body-small text-ink-muted">Official website</p>
          </div>
          <span className="type-label-medium bg-surface-container text-ink-soft shrink-0 rounded-full px-3 py-1">
            Visit <ArrowRight className="ml-0.5 inline h-3 w-3" />
          </span>
        </a>
      ) : null}

      {email || phone || firstSeen ? (
        <div className="grid grid-cols-1 gap-4">
          {email ? (
            <ContactCell
              icon={<Mail className="text-ink-muted h-4 w-4" />}
              label="Email"
              value={
                <a href={`mailto:${email}`} className="text-accent break-words hover:underline">
                  {email}
                </a>
              }
            />
          ) : null}
          {phone ? (
            <ContactCell
              icon={<Phone className="text-ink-muted h-4 w-4" />}
              label="Phone"
              value={
                <a href={`tel:${phone}`} className="text-accent hover:underline">
                  {phone}
                </a>
              }
            />
          ) : null}
          {firstSeen ? (
            <ContactCell
              icon={<Calendar className="text-ink-muted h-4 w-4" />}
              label="First seen"
              value={formatPresenceDate(firstSeen)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
