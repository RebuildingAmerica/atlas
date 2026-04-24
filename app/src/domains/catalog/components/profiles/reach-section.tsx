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

export function ReachSection({ email, website, phone }: ReachSectionProps) {
  const hasAny = email || website || phone;
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      <p className="type-label-medium text-ink-muted">Reach</p>
      <div className="space-y-3">
        {email ? (
          <ContactCard
            icon={<Mail className="text-ink-muted h-4 w-4" />}
            label="Email"
            value={
              <a href={`mailto:${email}`} className="text-accent break-words hover:underline">
                {email}
              </a>
            }
          />
        ) : null}
        {website ? (
          <ContactCard
            icon={<Globe className="text-ink-muted h-4 w-4" />}
            label="Website"
            value={
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {website}
              </a>
            }
          />
        ) : null}
        {phone ? (
          <ContactCard
            icon={<Phone className="text-ink-muted h-4 w-4" />}
            label="Phone"
            value={
              <a href={`tel:${phone}`} className="text-accent hover:underline">
                {phone}
              </a>
            }
          />
        ) : null}
      </div>
    </div>
  );
}
