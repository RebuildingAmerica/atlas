import { Link } from "@tanstack/react-router";

/**
 * One navigation link rendered in the organization page header.
 */
interface OrganizationPageHeaderLink {
  label: string;
  to: "/discovery" | "/organization" | "/organization/sso";
}

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
        <div className="flex flex-wrap gap-3">
          {links.map((link) => (
            <Link
              key={`${link.to}-${link.label}`}
              className="type-body-medium text-ink-strong underline"
              to={link.to}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
