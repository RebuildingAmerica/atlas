import { ArrowUpRight } from "lucide-react";

interface FooterInternalLink {
  href: `/${string}`;
  label: string;
  kind: "internal" | "native";
}

interface FooterExternalLink {
  href: `https://${string}`;
  label: string;
  kind: "external";
}

type FooterLink = FooterInternalLink | FooterExternalLink;

interface FooterColumn {
  heading: string;
  links: FooterLink[];
}

interface PublicFooterProps {
  localMode: boolean;
  status?: unknown;
}

const PRODUCT_LINKS: FooterLink[] = [
  { href: "/browse", label: "Search", kind: "internal" },
  { href: "/map", label: "Map", kind: "internal" },
  { href: "/firehose", label: "Firehose", kind: "internal" },
  { href: "/docs", label: "Docs", kind: "native" },
  { href: "/docs/how-it-works", label: "How it works", kind: "native" },
  { href: "/docs/resources/trust", label: "Trust & sources", kind: "native" },
  { href: "/pricing", label: "Pricing", kind: "internal" },
];

const COMMUNITY_LINKS: FooterLink[] = [
  { href: "/docs/resources/open-source", label: "Open source", kind: "native" },
  { href: "https://github.com/RebuildingAmerica/atlas", label: "GitHub", kind: "external" },
  { href: "https://github.com/RebuildingAmerica/atlas/issues", label: "Issues", kind: "external" },
  { href: "https://climate.stripe.com/IbySpr", label: "Carbon removal", kind: "external" },
];

const LEGAL_LINKS: FooterLink[] = [
  { href: "/privacy", label: "Privacy", kind: "internal" },
  { href: "/terms", label: "Terms", kind: "internal" },
  { href: "/security", label: "Security", kind: "internal" },
];

function footerColumns(localMode: boolean): FooterColumn[] {
  return [
    {
      heading: "Product",
      links: localMode ? PRODUCT_LINKS.filter((link) => link.href !== "/pricing") : PRODUCT_LINKS,
    },
    { heading: "Community", links: COMMUNITY_LINKS },
    { heading: "Legal", links: LEGAL_LINKS },
  ];
}

function FooterNavigationLink({ link }: { link: FooterLink }) {
  const className =
    "type-body-medium text-surface/80 hover:text-surface inline-flex w-fit items-center gap-1.5 no-underline transition-colors duration-150 hover:underline";

  if (link.kind === "external") {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
        {link.label}
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    );
  }

  if (link.kind === "native") {
    return (
      <a href={link.href} className={className}>
        {link.label}
      </a>
    );
  }

  return (
    <a href={link.href} className={className}>
      {link.label}
    </a>
  );
}

export function PublicFooter({ localMode }: PublicFooterProps) {
  const columns = footerColumns(localMode);

  return (
    <footer
      aria-label="Site footer"
      className="bg-accent-deep/95 text-surface relative flex h-[100svh] max-h-[100svh] flex-col overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="border-surface/25 pointer-events-none absolute inset-5 border"
      />

      <div className="border-surface/15 relative flex items-center justify-between gap-4 border-b px-8 pt-7 pb-5 md:px-12 md:pt-8">
        <a
          href="https://rebuildingus.org"
          target="_blank"
          rel="noopener noreferrer"
          className="type-label-medium text-surface/75 hover:text-surface no-underline transition-colors duration-150 hover:underline"
        >
          Rebuilding America Project
        </a>
        <p className="type-label-small text-surface/45 hidden sm:block">38°54N 77°02W</p>
      </div>

      <div className="relative grid flex-1 items-center gap-10 px-8 py-7 md:grid-cols-[minmax(0,1.08fr)_minmax(24rem,0.92fr)] md:px-12 md:py-10">
        <div className="max-w-3xl">
          <blockquote className="font-serif text-[clamp(1.45rem,3.2svh,2.7rem)] leading-snug text-balance italic">
            “Never doubt that a small group of thoughtful, committed citizens can change the world.
            Indeed, it is the only thing that ever has.”
          </blockquote>
          <div className="bg-surface/35 mt-7 h-px w-10" />
          <p className="type-label-small text-surface/60 mt-5">Margaret Mead</p>
        </div>

        <nav aria-label="Footer navigation" className="grid grid-cols-3 gap-5 md:gap-7">
          {columns.map((column) => (
            <div key={column.heading}>
              <p className="type-label-medium text-surface mb-4">{column.heading}</p>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <FooterNavigationLink link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="border-surface/20 relative border-t px-8 pt-3 md:px-12 md:pt-4">
        <a
          href="/"
          aria-label="Atlas"
          className="text-surface flex w-full justify-between overflow-hidden font-serif text-[clamp(4.25rem,15vw,13rem)] leading-[0.82] font-bold no-underline"
        >
          {"ATLAS".split("").map((letter, index) => (
            <span key={`${letter}-${String(index)}`}>{letter}</span>
          ))}
        </a>
      </div>

      <div className="border-surface/15 relative flex flex-col justify-between gap-3 border-t px-8 pt-3 pb-7 md:flex-row md:px-12 md:pt-4">
        <p className="type-body-small text-surface/60 max-w-4xl">
          Public records, organized for civic discovery.
        </p>
        <div className="flex shrink-0 gap-5">
          {LEGAL_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="type-body-small text-surface/65 hover:text-surface no-underline transition-colors duration-150 hover:underline"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
