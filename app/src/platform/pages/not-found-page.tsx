import { Link } from "@tanstack/react-router";
import { PublicFloatingNav } from "@/platform/layout/public-nav";
import { PublicFooter } from "@/platform/layout/public-footer";
import { Button } from "@/platform/ui/button";

/**
 * Decorative right panel — map grid with a location pin.
 * Hidden on mobile; shown md and up.
 */
function MapDecoPanel() {
  return (
    <div
      className="bg-surface-container-high relative my-8 mr-8 hidden overflow-hidden rounded-2xl md:flex md:w-[38%] md:items-center md:justify-center"
      aria-hidden="true"
    >
      {/* Grid pattern */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            "linear-gradient(color-mix(in srgb, var(--color-primary) 18%, transparent) 1px, transparent 1px)",
            "linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 18%, transparent) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "24px 24px",
        }}
      />
      {/* Location pin */}
      <div className="bg-primary relative z-10 h-10 w-10 -rotate-45 rounded-[50%_50%_50%_0] shadow-[0_4px_16px_color-mix(in_srgb,var(--color-primary)_40%,transparent)]">
        <span className="absolute inset-0 flex rotate-45 items-center justify-center">
          <span className="h-3.5 w-3.5 rounded-full bg-white" />
        </span>
      </div>
    </div>
  );
}

/**
 * Full-page 404 component used as the root `notFoundComponent`.
 *
 * Renders the public nav and footer so unmatched routes always look like
 * the rest of the site. Footer gets a static "unknown" status — no point
 * making network requests when we're already in a not-found state.
 */
export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 md:p-4">
        <PublicFloatingNav />
      </header>

      <main className="flex flex-1">
        <div className="mx-auto flex w-full max-w-[88rem] flex-1">
          {/* Left — content */}
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center md:items-start md:px-12 md:text-left lg:px-16">
            <p className="type-label-small text-primary mb-3 tracking-widest uppercase">
              404 · Page not found
            </p>
            <h1 className="type-display-small text-on-surface mb-4">
              We lost the map
              <br />
              for this one
            </h1>
            <p className="type-body-large text-outline mb-8 max-w-sm">
              That page doesn't exist in our records — it may have moved, been renamed, or the link
              might be broken.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link to="/">
                <Button variant="primary">← Back to home</Button>
              </Link>
              <Link to="/browse">
                <Button variant="secondary">Browse entries</Button>
              </Link>
            </div>
          </div>

          <MapDecoPanel />
        </div>
      </main>

      <PublicFooter status="unknown" />
    </div>
  );
}
