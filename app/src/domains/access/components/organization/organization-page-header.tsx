import { Link } from "@tanstack/react-router";

/**
 * One navigation link rendered in the organization page header.
 */
export interface OrganizationPageHeaderLink {
  label: string;
  to: "/discovery" | "/organization" | "/organization/sso";
}

export const ORGANIZATION_SETTINGS_LINKS: OrganizationPageHeaderLink[] = [
  { label: "Workspace", to: "/organization" },
  { label: "Enterprise sign-in", to: "/organization/sso" },
];

export const WORKSPACE_SETTINGS_LINKS: OrganizationPageHeaderLink[] = [
  { label: "Workspace", to: "/organization" },
];

/**
 * Props for the shared organization page header.
 */
interface OrganizationPageHeaderProps {
  description: string;
  label: string;
  links?: OrganizationPageHeaderLink[];
  title: string;
}

/**
 * Shared heading block used by the organization-management pages.
 */
export function OrganizationPageHeader({
  description,
  label,
  links = [],
  title,
}: OrganizationPageHeaderProps) {
  return (
    <section className="space-y-3">
      <p className="type-label-medium text-ink-muted">{label}</p>
      <h1 className="type-headline-large text-ink-strong">{title}</h1>
      <p className="type-body-large text-ink-soft max-w-3xl">{description}</p>
      {links.length ? (
        <nav
          aria-label="Organization settings"
          className="border-border bg-surface-container-lowest flex w-fit max-w-full flex-wrap gap-1 rounded-lg border p-1"
        >
          {links.map((link) => (
            <Link
              key={`${link.to}-${link.label}`}
              className="type-label-large text-ink-soft hover:bg-surface-container hover:text-ink-strong rounded-md px-3 py-2 no-underline"
              to={link.to}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </section>
  );
}
