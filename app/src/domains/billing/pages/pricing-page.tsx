import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Placeholder checkout handler — wire to real startCheckout when ready
// ---------------------------------------------------------------------------

function startCheckout(_planId: string) {
  // TODO: Wire to real checkout flow once Stripe integration is complete
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Feature {
  text: string;
}

interface ProductCardProps {
  label: string;
  price: ReactNode;
  description: string;
  features: Feature[];
  cta?: {
    label: string;
    planId: string;
  };
  featured?: boolean;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FeatureList({ features }: { features: Feature[] }) {
  return (
    <ul className="mt-5 space-y-2.5" aria-label="Included features">
      {features.map((feature) => (
        <li key={feature.text} className="flex items-start gap-2.5">
          <span
            className="bg-accent-soft text-accent-deep mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path
                d="M1.5 4L3.25 5.75L6.5 2.5"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="type-body-medium text-ink-soft">{feature.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ProductCard({ label, price, description, features, cta, featured }: ProductCardProps) {
  return (
    <article
      className={[
        "flex flex-col rounded-[1.4rem] border p-6",
        featured
          ? "border-accent bg-surface-container-lowest shadow-soft"
          : "border-border bg-surface-container-lowest",
      ].join(" ")}
    >
      {/* Header */}
      <header>
        {featured ? (
          <p className="type-label-medium text-accent mb-2 tracking-widest uppercase">
            Most popular
          </p>
        ) : null}
        <h2 className="type-title-large text-ink-strong">{label}</h2>
        <div className="mt-2">{price}</div>
        <p className="type-body-medium text-ink-muted mt-2">{description}</p>
      </header>

      {/* Features */}
      <FeatureList features={features} />

      {/* CTA */}
      {cta ? (
        <div className="mt-auto pt-6">
          <button
            type="button"
            onClick={() => {
              startCheckout(cta.planId);
            }}
            className={[
              "type-label-large w-full rounded-full px-4 py-2.5 text-center font-medium transition-[background-color,border-color] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none",
              featured
                ? "bg-accent hover:bg-accent-deep focus:ring-accent text-white"
                : "border-border text-ink-strong hover:border-border-strong hover:bg-surface-container-high focus:ring-border-strong border bg-transparent",
            ].join(" ")}
          >
            {cta.label}
          </button>
        </div>
      ) : (
        <div className="mt-auto pt-6">
          <p className="type-label-medium text-ink-muted text-center">No card required</p>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Price displays
// ---------------------------------------------------------------------------

function FreePrice() {
  return <p className="type-headline-medium text-ink-strong">Free</p>;
}

function ProPrice() {
  return (
    <p className="type-headline-medium text-ink-strong">
      $5
      <span className="type-body-large text-ink-muted font-normal">/month</span>
      <span className="type-label-medium text-ink-muted ml-2 font-normal">or $48/year</span>
    </p>
  );
}

function TeamPrice() {
  return (
    <p className="type-headline-medium text-ink-strong">
      $25
      <span className="type-body-large text-ink-muted font-normal">/month</span>
      <span className="type-label-medium text-ink-muted ml-2 font-normal">+ $8/seat</span>
    </p>
  );
}

function ResearchPassPrice() {
  return (
    <p className="type-headline-medium text-ink-strong">
      $50
      <span className="type-body-large text-ink-muted font-normal">/30 days</span>
      <span className="type-label-medium text-ink-muted ml-2 font-normal">or $12/week</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Public-facing pricing page.
 *
 * Accessible without authentication. Shows Atlas's three product tiers and
 * a Research Pass option. CTA buttons call startCheckout(), which will be
 * wired to the actual checkout flow separately.
 */
export function PricingPage() {
  return (
    <div className="bg-page-bg flex min-h-screen flex-col">
      {/* Minimal nav */}
      <header className="sticky top-0 z-30 md:p-4">
        <nav
          className="border-border mx-auto flex max-w-3xl items-center justify-between rounded-2xl border px-4 py-2.5 shadow-sm backdrop-blur-md md:px-5 md:py-3"
          style={{ backgroundColor: "rgba(248, 241, 230, 0.8)" }}
          aria-label="Site navigation"
        >
          <Link to="/" className="flex items-center gap-2.5 no-underline">
            <div className="bg-accent flex h-7 w-7 items-center justify-center rounded-xl text-white">
              <span className="type-label-medium leading-none">A</span>
            </div>
            <span className="type-title-medium text-ink-strong">Atlas</span>
          </Link>

          <div className="flex items-center gap-1">
            <Link
              to="/browse"
              className="type-label-large text-ink-muted hover:bg-surface-container hover:text-ink-strong rounded-lg px-3 py-1.5 no-underline"
            >
              Browse
            </Link>
            <Link
              to="/sign-in"
              className="type-label-large text-ink-muted hover:bg-surface-container hover:text-ink-strong rounded-lg px-3 py-1.5 no-underline"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      {/* Page body */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 md:py-20">
        {/* Page header */}
        <section aria-labelledby="pricing-heading" className="mx-auto max-w-2xl text-center">
          <p className="type-label-medium text-ink-muted tracking-widest uppercase">Pricing</p>
          <h1 id="pricing-heading" className="type-display-small text-ink-strong mt-3">
            Atlas Pricing
          </h1>
          <p className="type-body-large text-ink-soft mt-4">
            You never pay to see civic data. You pay to work with it professionally.
          </p>
        </section>

        {/* Product cards — main three tiers */}
        <section
          aria-label="Subscription plans"
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <ProductCard
            label="Default"
            price={<FreePrice />}
            description="Everything you need to explore Atlas without a commitment."
            features={[
              { text: "Browse, search, and profiles — unlimited" },
              { text: "2 research runs / month" },
              { text: "1 shortlist (25 entries)" },
            ]}
          />

          <ProductCard
            label="Atlas Pro"
            price={<ProPrice />}
            description="For researchers and professionals who need the full toolkit."
            features={[
              { text: "Everything in Default" },
              { text: "Unlimited research runs" },
              { text: "Unlimited shortlists and notes" },
              { text: "CSV and JSON export" },
              { text: "1 API key (1,000 req/day)" },
              { text: "MCP and OAuth access" },
            ]}
            cta={{ label: "Get Pro", planId: "atlas-pro" }}
            featured
          />

          <ProductCard
            label="Atlas Team"
            price={<TeamPrice />}
            description="Shared workspace for organizations doing civic research at scale."
            features={[
              { text: "Everything in Pro" },
              { text: "Shared workspace" },
              { text: "Unlimited API keys (10,000 req/day/key)" },
              { text: "Watchlists and monitoring" },
              { text: "Slack integration" },
              { text: "SSO (SAML/OIDC)" },
              { text: "Up to 50 members" },
            ]}
            cta={{ label: "Get Team", planId: "atlas-team" }}
          />
        </section>

        {/* Research Pass — separate row, shorter card */}
        <section aria-label="Research Pass" className="mt-4">
          <div className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1">
                <h2 className="type-title-large text-ink-strong">Atlas Research Pass</h2>
                <div className="mt-1">
                  <ResearchPassPrice />
                </div>
                <p className="type-body-medium text-ink-muted mt-2">
                  Full Pro capabilities for a fixed window. No subscription, no commitment.
                </p>
              </div>

              <ul
                className="type-body-medium text-ink-soft flex flex-col gap-1.5 sm:min-w-48"
                aria-label="Research Pass features"
              >
                <li className="flex items-center gap-2">
                  <span className="text-accent">--</span> Pro capabilities, temporarily
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent">--</span> No commitment
                </li>
              </ul>

              <div className="sm:ml-6 sm:shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    startCheckout("atlas-research-pass");
                  }}
                  className="type-label-large border-border text-ink-strong hover:border-border-strong hover:bg-surface-container-high focus:ring-border-strong w-full rounded-full border bg-transparent px-6 py-2.5 text-center font-medium transition-[background-color,border-color] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none sm:w-auto"
                >
                  Get Research Pass
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Footer note */}
        <footer className="border-border mt-12 border-t pt-8 text-center">
          <p className="type-body-medium text-ink-muted">
            All plans are billed in USD. Subscriptions can be cancelled at any time.{" "}
            <Link
              to="/sign-in"
              className="text-ink-soft hover:text-ink-strong underline underline-offset-2"
            >
              Sign in
            </Link>{" "}
            to manage your account.
          </p>
        </footer>
      </main>
    </div>
  );
}
