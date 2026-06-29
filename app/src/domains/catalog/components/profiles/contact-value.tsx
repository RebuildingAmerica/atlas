interface ContactValueProps {
  value: string;
  href: string;
  grounded?: boolean | null;
  external?: boolean;
}

/** Caption shown beneath a contact value that no source corroborates. */
export function UngroundedNote() {
  return <p className="type-label-small text-ink-muted">Not confirmed by a source</p>;
}

/** Render a contact value as an actionable link, or — when no source supports it — plain text. */
export function ContactValue({ value, href, grounded, external = false }: ContactValueProps) {
  if (grounded === false) {
    return (
      <>
        <span className="text-ink-strong break-words">{value}</span>
        <UngroundedNote />
      </>
    );
  }
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="text-accent focus-visible:ring-civic rounded-sm break-words hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {value}
    </a>
  );
}
