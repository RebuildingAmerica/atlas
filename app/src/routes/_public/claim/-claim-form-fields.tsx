import { Contact, Eye, FileText, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface FieldBlockProps {
  label: string;
  help: string;
  htmlFor: string;
  icon?: LucideIcon;
  children: ReactNode;
}

export function FieldBlock({ label, help, htmlFor, icon: Icon, children }: FieldBlockProps) {
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

export function ClaimVisibilitySummary() {
  return (
    <section className="border-outline-variant bg-surface-container-lowest rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Eye className="text-ink-muted h-4 w-4" aria-hidden />
        <h3 className="type-title-small text-ink-strong">Visible after verification</h3>
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
          title="Sources"
          description="Public sources attached to the profile."
        />
      </ul>
    </section>
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
