import { Globe, Mail, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { ContactValue } from "@/domains/catalog/components/profiles/contact-value";

interface ReachSectionProps {
  email?: string;
  website?: string;
  phone?: string;
  emailGrounded?: boolean | null;
  websiteGrounded?: boolean | null;
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

export function ReachSection({
  email,
  website,
  phone,
  emailGrounded,
  websiteGrounded,
}: ReachSectionProps) {
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
            value={<ContactValue value={email} href={`mailto:${email}`} grounded={emailGrounded} />}
          />
        ) : null}
        {website ? (
          <ContactCard
            icon={<Globe className="text-ink-muted h-4 w-4" />}
            label="Website"
            value={
              <ContactValue value={website} href={website} grounded={websiteGrounded} external />
            }
          />
        ) : null}
        {phone ? (
          <ContactCard
            icon={<Phone className="text-ink-muted h-4 w-4" />}
            label="Phone"
            value={
              <a
                href={`tel:${phone}`}
                className="text-accent focus-visible:ring-civic rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {phone}
              </a>
            }
          />
        ) : null}
      </div>
    </div>
  );
}
