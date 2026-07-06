import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { getStatus, type Status } from "@openstatus/react";

/* v8 ignore start -- callers always pass an animationDelay; the undefined branch exists only to satisfy the optional prop */
function resolveFooterItemStyle(
  animationDelay: string | undefined,
): React.CSSProperties | undefined {
  return animationDelay ? { animationDelay } : undefined;
}
/* v8 ignore stop */

interface FooterInternalLinkProps {
  to: string;
  label: string;
  animationDelay?: string;
  native?: boolean;
}

function FooterInternalLink({
  to,
  label,
  animationDelay,
  native = false,
}: FooterInternalLinkProps) {
  const className =
    "type-body-small text-ink-muted hover:text-ink no-underline transition-colors duration-150 hover:underline";

  if (native) {
    return (
      <li className="footer-fade-item" style={resolveFooterItemStyle(animationDelay)}>
        <a href={to} className={className}>
          {label}
        </a>
      </li>
    );
  }

  return (
    <li className="footer-fade-item" style={resolveFooterItemStyle(animationDelay)}>
      <Link to={to} className={className}>
        {label}
      </Link>
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
    <li className="footer-fade-item" style={resolveFooterItemStyle(animationDelay)}>
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

const STATUS_MONITOR_ID = "atlasapp";
const STATUS_CACHE_MS = 1000 * 60;
const STATUS_TIMEOUT_MS = 2500;

interface StatusCacheEntry {
  status: Status;
  updatedAt: number;
}

let statusCache: StatusCacheEntry | null = null;

function cachedFooterStatus(now: number): Status | null {
  if (!statusCache) {
    return null;
  }

  return now - statusCache.updatedAt <= STATUS_CACHE_MS ? statusCache.status : null;
}

async function loadFooterStatus(): Promise<Status> {
  const cached = cachedFooterStatus(Date.now());
  if (cached) {
    return cached;
  }

  const timeoutPromise = new Promise<Status>((resolve) => {
    window.setTimeout(() => {
      resolve("unknown");
    }, STATUS_TIMEOUT_MS);
  });
  const statusPromise = getStatus(STATUS_MONITOR_ID)
    .then((result) => result.status)
    .catch((): Status => "unknown");
  const status = await Promise.race([statusPromise, timeoutPromise]);
  statusCache = { status, updatedAt: Date.now() };
  return status;
}

interface PublicFooterProps {
  localMode: boolean;
  status?: Status;
}

/**
 * Grounded public footer for Atlas.
 *
 * Brand + mission left column; three nav columns right. Faint topographic
 * SVG pattern for texture. Staggered fade-in via CSS scroll-driven animations.
 * Sits flush at page bottom — no border-radius, not floating.
 */
export function PublicFooter({ localMode, status }: PublicFooterProps) {
  const [footerStatus, setFooterStatus] = useState<Status>(status ?? "unknown");
  const { label, color, pulse } = STATUS_CONFIG[footerStatus];

  useEffect(() => {
    let cancelled = false;

    void loadFooterStatus().then((nextStatus) => {
      if (!cancelled) {
        setFooterStatus(nextStatus);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

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
                Source-linked local civic intelligence for the issues that matter most.
              </p>
              <p className="type-body-small text-ink-soft">
                Free, open-source civic research built for communities across America.
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
              <FooterInternalLink to="/browse" label="Search" animationDelay="120ms" />
              <FooterInternalLink to="/map" label="Map" animationDelay="140ms" />
              <FooterInternalLink to="/firehose" label="Firehose" animationDelay="160ms" />
              <FooterInternalLink to="/docs" label="Docs" native animationDelay="180ms" />
              <FooterInternalLink
                to="/docs/how-it-works"
                label="How it works"
                native
                animationDelay="200ms"
              />
              <FooterInternalLink
                to="/docs/resources/trust"
                label="Trust & sources"
                native
                animationDelay="220ms"
              />
              {!localMode ? (
                <FooterInternalLink to="/pricing" label="Pricing" animationDelay="240ms" />
              ) : null}
            </FooterNavColumn>

            <FooterNavColumn heading="Community" baseDelay={140}>
              <FooterInternalLink
                to="/docs/resources/open-source"
                label="Open source"
                native
                animationDelay="240ms"
              />
              <FooterExternalLink
                href="https://github.com/RebuildingAmerica/atlas"
                label="GitHub"
                animationDelay="260ms"
              />
              <FooterExternalLink
                href="https://climate.stripe.com/IbySpr"
                label="Carbon removal"
                animationDelay="280ms"
              />
              <FooterExternalLink
                href="https://github.com/RebuildingAmerica/atlas/issues"
                label="Issues"
                animationDelay="300ms"
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
