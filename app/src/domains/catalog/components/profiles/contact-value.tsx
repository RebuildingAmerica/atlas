import { safeWebsiteHref } from "@/domains/catalog/components/profiles/website-url";

interface ContactValueProps {
  value: string;
  href: string;
  grounded?: boolean | null;
  external?: boolean;
}

/** Caption shown beneath a contact value that no source corroborates. */
export function UngroundedNote({ grounded }: { grounded?: boolean | null }) {
  return (
    <p className="type-label-small text-ink-muted">
      {grounded === false ? "Not confirmed by a source" : "Source support not reviewed"}
    </p>
  );
}

/** Render a contact value as an actionable link, or — when no source supports it — plain text. */
export function ContactValue({ value, href, grounded, external = false }: ContactValueProps) {
  const safeHref = external ? safeWebsiteHref(href) : href;
  if (grounded !== true || !safeHref) {
    return (
      <>
        <span className="text-ink-strong break-words">{value}</span>
        {grounded === true ? (
          <p className="type-label-small text-ink-muted">Invalid website address</p>
        ) : (
          <UngroundedNote grounded={grounded} />
        )}
      </>
    );
  }
  return (
    <a
      href={safeHref}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-accent-deep focus-visible:ring-civic rounded-sm break-words hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {value}
    </a>
  );
}
