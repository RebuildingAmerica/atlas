import { useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { isRecoverablePublicLoaderError } from "./public-loader-errors";

/** Seconds to wait before each automatic retry of an outage. */
export const ROUTE_RETRY_DELAYS_SECONDS = [5, 15, 45] as const;

/**
 * The error state for any route below the root, rendered inside its layout.
 *
 * TanStack Router's own default replaces the page body with "Something went
 * wrong!" and a button that prints the raw error, and it is what visitors saw
 * when the API rate-limited server renders on 2026-09-14. This keeps the
 * surrounding navigation and footer, never shows internals, and, when the
 * failure is an outage rather than a bug, retries on its own so the page
 * recovers without the visitor doing anything.
 */
export function RouteErrorPanel({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const recoverable = isRecoverablePublicLoaderError(error);
  const [attempt, setAttempt] = useState(0);
  const delay = recoverable ? ROUTE_RETRY_DELAYS_SECONDS[attempt] : undefined;

  useEffect(() => {
    if (delay === undefined) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setAttempt((current) => current + 1);
      void router.invalidate();
    }, delay * 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [delay, router]);

  function retry() {
    reset();
    void router.invalidate();
  }

  return (
    <section
      aria-live="polite"
      className="mx-auto my-10 w-full max-w-xl px-4 sm:px-6"
      data-testid="route-error-panel"
    >
      <div className="bg-surface-container-high border-border-strong rounded-[1.1rem] border p-6">
        <p className="type-title-medium text-ink-strong">
          {recoverable ? "Atlas is busy right now" : "This page hit a problem"}
        </p>
        <p className="type-body-small text-ink-soft mt-1.5">
          {delay === undefined
            ? "The rest of Atlas still works. Give this page another try."
            : `Trying again in ${delay} seconds.`}
        </p>
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={retry}>
            <span className="inline-flex items-center gap-1.5">
              <RotateCcw className="h-4 w-4" aria-hidden />
              Try again now
            </span>
          </Button>
        </div>
      </div>
    </section>
  );
}
