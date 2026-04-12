import { Globe, Mail, Phone } from "lucide-react";
import type { ReactNode } from "react";

interface ReachSectionProps {
  email?: string;
  website?: string;
  phone?: string;
}

interface ContactCardProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}

function ContactCard({ icon, label, value }: ContactCardProps) {
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

export function ReachSection({ email, website, phone }: ReachSectionProps) {
  const hasAny = email || website || phone;
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      <p className="type-label-small tracking-widest text-[var(--ink-muted)] uppercase">Reach</p>
      <div className="space-y-3">
        {email ? (
          <ContactCard
            icon={<Mail className="h-4 w-4 text-[var(--ink-muted)]" />}
            label="Email"
            value={
              <a href={`mailto:${email}`} className="text-[var(--accent)] hover:underline">
                {email}
              </a>
            }
          />
        ) : null}
        {website ? (
          <ContactCard
            icon={<Globe className="h-4 w-4 text-[var(--ink-muted)]" />}
            label="Website"
            value={
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                {website}
              </a>
            }
          />
        ) : null}
        {phone ? (
          <ContactCard
            icon={<Phone className="h-4 w-4 text-[var(--ink-muted)]" />}
            label="Phone"
            value={phone}
          />
        ) : null}
      </div>
    </div>
  );
}
