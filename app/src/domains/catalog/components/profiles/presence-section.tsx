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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function ContactCell({ icon, label, value }: ContactCellProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-container)]">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="type-label-small text-[var(--ink-muted)] uppercase">{label}</p>
        <p className="type-body-medium text-[var(--ink-strong)]">{value}</p>
      </div>
    </div>
  );
}

export function PresenceSection({ website, email, phone, firstSeen }: PresenceSectionProps) {
  const hasAny = website || email || phone || firstSeen;
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      <p className="type-label-small tracking-widest text-[var(--ink-muted)] uppercase">Presence</p>

      {website ? (
        <a
          href={website}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-container-lowest)] p-4 transition-colors hover:bg-[var(--surface-container-low)]"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ink-strong)]">
            <Globe className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="type-title-small text-[var(--ink-strong)]">{extractDomain(website)}</p>
            <p className="type-body-small text-[var(--ink-muted)]">Official website</p>
          </div>
          <span className="type-label-medium shrink-0 rounded-full bg-[var(--surface-container)] px-3 py-1 text-[var(--ink-soft)]">
            Visit <ArrowRight className="ml-0.5 inline h-3 w-3" />
          </span>
        </a>
      ) : null}

      {email || phone || firstSeen ? (
        <div className="grid grid-cols-2 gap-4">
          {email ? (
            <ContactCell
              icon={<Mail className="h-4 w-4 text-[var(--ink-muted)]" />}
              label="Email"
              value={
                <a href={`mailto:${email}`} className="text-[var(--accent)] hover:underline">
                  {email}
                </a>
              }
            />
          ) : null}
          {phone ? (
            <ContactCell
              icon={<Phone className="h-4 w-4 text-[var(--ink-muted)]" />}
              label="Phone"
              value={phone}
            />
          ) : null}
          {firstSeen ? (
            <ContactCell
              icon={<Calendar className="h-4 w-4 text-[var(--ink-muted)]" />}
              label="First seen"
              value={firstSeen}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
