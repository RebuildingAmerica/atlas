import { Link } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { PublicTopNavSafe } from "@/platform/layout/public-nav";
import { PublicFooter } from "@/platform/layout/public-footer";
import { Button } from "@/platform/ui/button";

/**
 * Decorative right panel — muted grid with a signal ring.
 * Slightly desaturated vs the 404 panel to signal "something's wrong on our
 * end" without being alarming.
 */
function SignalDecoPanel() {
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
            "linear-gradient(color-mix(in srgb, var(--color-outline) 12%, transparent) 1px, transparent 1px)",
            "linear-gradient(90deg, color-mix(in srgb, var(--color-outline) 12%, transparent) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "24px 24px",
        }}
      />
      {/* Signal ring */}
      <div className="border-outline relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 shadow-[0_0_0_10px_color-mix(in_srgb,var(--color-outline)_12%,transparent),0_0_0_20px_color-mix(in_srgb,var(--color-outline)_6%,transparent)]">
        <span className="bg-outline h-2.5 w-2.5 rounded-full" />
      </div>
    </div>
  );
}

/**
 * Full-page 500 component used as the root `errorComponent`.
 *
 * Renders the public nav and footer so errors always look like the rest of
 * the site. The "Try again" button calls `reset()` to re-render the route
 * tree. Footer gets a static "unknown" status — no network requests in an
 * error state.
 */
export function ErrorPage({ reset }: ErrorComponentProps) {
  const session = useAtlasSession();
  const localMode = session.data?.isLocal ?? false;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30">
        <PublicTopNavSafe />
      </header>

      <main className="flex flex-1">
        <div className="mx-auto flex w-full max-w-[88rem] flex-1">
          {/* Left — content */}
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center md:items-start md:px-12 md:text-left lg:px-16">
            <p className="type-label-small text-outline mb-3 tracking-widest uppercase">
              500 · Something went wrong
            </p>
            <h1 className="type-display-small text-on-surface mb-4">
              We're working
              <br />
              on it
            </h1>
            <p className="type-body-large text-outline mb-8 max-w-sm">
              Something broke on our end. Try again in a moment, or check the status page for
              updates.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                variant="primary"
                onClick={reset}
                className="bg-ink-strong hover:bg-ink-muted focus:ring-ink-strong text-white"
              >
                Try again
              </Button>
              <a href="https://atlasapp.openstatus.dev" target="_blank" rel="noopener noreferrer">
                <Button variant="secondary">Check status ↗</Button>
              </a>
              <Link to="/">
                <Button variant="secondary">Back to home</Button>
              </Link>
            </div>
          </div>

          <SignalDecoPanel />
        </div>
      </main>

      <PublicFooter localMode={localMode} status="unknown" />
    </div>
  );
}
