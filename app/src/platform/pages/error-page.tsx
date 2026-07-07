import { Link } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { PublicTopNavSafe } from "@/platform/layout/public-nav";
import { PublicFooter } from "@/platform/layout/public-footer";
import { ATLAS_STATUS_PAGE_URL } from "@/platform/status/status-config";
import { Button } from "@/platform/ui/button";

/**
 * Decorative right panel — muted grid with a signal ring.
 * Slightly desaturated vs the 404 panel to signal "something's wrong on our
 * end" without being alarming.
 */
function SignalDecoPanel() {
  return (
    <div
      className="border-border bg-surface-container-high relative min-h-72 overflow-hidden rounded-[1.35rem] border md:min-h-[22rem]"
      aria-hidden="true"
    >
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
      <div className="absolute inset-x-8 top-8 flex items-center justify-between">
        <span className="type-label-small text-ink-muted uppercase">Atlas status</span>
        <span className="border-border bg-surface-container-lowest text-ink-muted rounded-full border px-2.5 py-1 text-xs">
          500
        </span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="border-outline relative z-10 flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-[0_0_0_14px_color-mix(in_srgb,var(--color-outline)_12%,transparent),0_0_0_28px_color-mix(in_srgb,var(--color-outline)_6%,transparent),0_0_0_48px_color-mix(in_srgb,var(--color-outline)_3%,transparent)]">
          <span className="bg-outline h-3 w-3 rounded-full" />
        </div>
      </div>
      <p className="type-body-small text-ink-muted absolute right-8 bottom-7 left-8">
        The page could not load.
      </p>
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

      <main className="flex flex-1 items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,0.75fr)]">
          <section className="max-w-2xl">
            <p className="type-label-small text-ink-muted tracking-widest uppercase">
              500 · Something went wrong
            </p>
            <h1 className="type-display-small text-ink-strong mt-4 text-balance">
              Something went wrong.
            </h1>
            <p className="type-body-large text-ink-soft mt-4 max-w-xl text-balance">
              Try again in a moment, check current service status, or return home.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button
                variant="primary"
                onClick={reset}
                className="bg-ink-strong hover:bg-ink-muted focus:ring-ink-strong text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Try again
                </span>
              </Button>
              <a href={ATLAS_STATUS_PAGE_URL} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary">
                  <span className="inline-flex items-center gap-2">
                    Check status
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                </Button>
              </a>
              <Link to="/">
                <Button variant="secondary">Back to home</Button>
              </Link>
            </div>
          </section>
          <SignalDecoPanel />
        </div>
      </main>

      <PublicFooter localMode={localMode} status="unknown" />
    </div>
  );
}
