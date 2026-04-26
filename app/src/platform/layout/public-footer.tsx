import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { Status } from "@openstatus/react";

interface FooterInternalLinkProps {
  to: string;
  label: string;
  animationDelay?: string;
}

function FooterInternalLink({ to, label, animationDelay }: FooterInternalLinkProps) {
  return (
    <li className="footer-fade-item" style={animationDelay ? { animationDelay } : undefined}>
      <Link
        to={to}
        className="type-body-small text-ink-muted hover:text-ink no-underline transition-colors duration-150 hover:underline"
      >
        {label}
      </Link>
    </li>
  );
}

interface FooterPlaceholderLinkProps {
  label: string;
  animationDelay?: string;
}

function FooterPlaceholderLink({ label, animationDelay }: FooterPlaceholderLinkProps) {
  return (
    <li className="footer-fade-item" style={animationDelay ? { animationDelay } : undefined}>
      <span className="footer-placeholder-link type-body-small text-ink-muted cursor-default opacity-50">
        {label}
      </span>
    </li>
  );
}

interface FooterExternalLinkProps {
  href: string;
  label: string;
  animationDelay?: string;
}

function FooterExternalLink({ href, label, animationDelay }: FooterExternalLinkProps) {
  return (
    <li className="footer-fade-item" style={animationDelay ? { animationDelay } : undefined}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="type-body-small text-ink-muted hover:text-ink group inline-flex items-center gap-1 no-underline transition-colors duration-150 hover:underline"
      >
        {label}
        <ArrowUpRight className="h-3 w-3 opacity-0 transition-all duration-150 group-hover:translate-x-px group-hover:-translate-y-px group-hover:opacity-70" />
      </a>
    </li>
  );
}

interface FooterNavColumnProps {
  heading: string;
  children: React.ReactNode;
  baseDelay?: number;
}

function FooterNavColumn({ heading, children, baseDelay = 0 }: FooterNavColumnProps) {
  return (
    <div className="footer-fade-item" style={{ animationDelay: `${baseDelay}ms` }}>
      <p className="type-label-small text-ink-muted mb-3 [letter-spacing:0.08em] uppercase">
        {heading}
      </p>
      <ul className="m-0 list-none space-y-2.5 p-0">{children}</ul>
    </div>
  );
}

/**
 * Inline SVG topographic contour-line texture as a decorative background.
 *
 * Sinusoidal Q-curve paths simulate map contour lines. Opacity is kept
 * at 3.5% so the effect reads as texture, not decoration.
 */
function TopographicTexture() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-[0.035]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cpath d='M0 200 Q50 150 100 200 Q150 250 200 200 Q250 150 300 200 Q350 250 400 200' fill='none' stroke='%2344403c' stroke-width='1.5'/%3E%3Cpath d='M0 240 Q50 190 100 240 Q150 290 200 240 Q250 190 300 240 Q350 290 400 240' fill='none' stroke='%2344403c' stroke-width='1.5'/%3E%3Cpath d='M0 160 Q50 110 100 160 Q150 210 200 160 Q250 110 300 160 Q350 210 400 160' fill='none' stroke='%2344403c' stroke-width='1.5'/%3E%3Cpath d='M0 280 Q50 230 100 280 Q150 330 200 280 Q250 230 300 280 Q350 330 400 280' fill='none' stroke='%2344403c' stroke-width='1.5'/%3E%3Cpath d='M0 120 Q50 70 100 120 Q150 170 200 120 Q250 70 300 120 Q350 170 400 120' fill='none' stroke='%2344403c' stroke-width='1.5'/%3E%3Cpath d='M0 320 Q50 270 100 320 Q150 370 200 320 Q250 270 300 320 Q350 370 400 320' fill='none' stroke='%2344403c' stroke-width='1.5'/%3E%3C/svg%3E")`,
        backgroundSize: "400px 400px",
      }}
    />
  );
}

const STATUS_CONFIG: Record<Status, { label: string; color: string; pulse: boolean }> = {
  operational: { label: "All systems operational", color: "bg-green-500", pulse: true },
  degraded_performance: { label: "Degraded performance", color: "bg-yellow-500", pulse: false },
  partial_outage: { label: "Partial outage", color: "bg-yellow-500", pulse: false },
  major_outage: { label: "Major outage", color: "bg-red-500", pulse: false },
  under_maintenance: { label: "Under maintenance", color: "bg-blue-400", pulse: false },
  incident: { label: "Active incident", color: "bg-red-500", pulse: false },
  unknown: { label: "Status unavailable", color: "bg-stone-400", pulse: false },
};

interface PublicFooterProps {
  localMode: boolean;
  status: Status;
}

/**
 * Grounded public footer for Atlas.
 *
 * Brand + mission left column; three nav columns right. Faint topographic
 * SVG pattern for texture. Staggered fade-in via CSS scroll-driven animations.
 * Sits flush at page bottom — no border-radius, not floating.
 */
export function PublicFooter({ localMode, status }: PublicFooterProps) {
  const { label, color, pulse } = STATUS_CONFIG[status];
  const shouldShowWorkspaceLink = !localMode;
  return (
    <footer
      aria-label="Site footer"
      className="border-border-strong bg-surface-container-high relative overflow-hidden border-t"
    >
      <TopographicTexture />

      <div className="relative mx-auto w-full max-w-[88rem] px-6 py-14 lg:px-8 lg:py-16">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_auto] lg:gap-16">
          {/* Brand + mission */}
          <div className="footer-fade-item max-w-sm space-y-5" style={{ animationDelay: "0ms" }}>
            <Link to="/" className="inline-flex items-center gap-2.5 no-underline">
              <div className="bg-accent flex h-8 w-8 items-center justify-center rounded-xl text-white">
                <span className="type-label-medium leading-none">A</span>
              </div>
              <span className="type-title-medium text-ink-strong">Atlas</span>
            </Link>

            <div className="space-y-2">
              <p className="type-body-medium text-ink-strong">
                Find people, organizations, and initiatives working on the issues that matter most.
              </p>
              <p className="type-body-small text-ink-soft">
                A free, open-source directory built for communities across America.
              </p>
            </div>

            <a
              href="https://atlasapp.openstatus.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="border-border-strong text-ink-muted hover:text-ink inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 no-underline transition-colors duration-150"
            >
              <span className="relative flex h-1.5 w-1.5">
                {pulse && (
                  <span
                    className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`}
                  />
                )}
                <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${color}`} />
              </span>
              <span className="type-label-small">{label}</span>
            </a>
          </div>

          {/* Nav columns */}
          <nav
            aria-label="Footer navigation"
            className="grid grid-cols-2 gap-8 sm:grid-cols-3 sm:gap-10"
          >
            <FooterNavColumn heading="Product" baseDelay={80}>
              <FooterInternalLink to="/browse" label="Browse" animationDelay="120ms" />
              <FooterInternalLink to="/pricing" label="Pricing" animationDelay="140ms" />
              <FooterPlaceholderLink label="API" animationDelay="160ms" />
              {shouldShowWorkspaceLink ? (
                <FooterInternalLink to="/discovery" label="Workspace" animationDelay="180ms" />
              ) : null}
            </FooterNavColumn>

            <FooterNavColumn heading="Community" baseDelay={140}>
              <FooterExternalLink
                href="https://github.com/RebuildingAmerica/atlas"
                label="GitHub"
                animationDelay="180ms"
              />
              <FooterExternalLink
                href="https://climate.stripe.com/IbySpr"
                label="Carbon removal"
                animationDelay="200ms"
              />
              <FooterExternalLink
                href="https://github.com/RebuildingAmerica/atlas/issues"
                label="Issues"
                animationDelay="220ms"
              />
            </FooterNavColumn>

            <FooterNavColumn heading="Legal" baseDelay={200}>
              <FooterInternalLink to="/privacy" label="Privacy" animationDelay="240ms" />
              <FooterInternalLink to="/terms" label="Terms" animationDelay="260ms" />
              <FooterInternalLink to="/security" label="Security" animationDelay="280ms" />
            </FooterNavColumn>
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="border-border mt-12 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
          <p className="type-body-small text-ink-muted">
            &copy; 2026{" "}
            <a
              href="https://rebuildingus.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-muted hover:text-ink decoration-ink-muted/40 hover:decoration-ink/40 underline decoration-dotted underline-offset-2 transition-colors duration-150 hover:decoration-solid"
            >
              Rebuilding America Project
            </a>
          </p>
          <p className="type-body-small text-ink-muted">Civic infrastructure, openly built.</p>
        </div>
      </div>
    </footer>
  );
}
