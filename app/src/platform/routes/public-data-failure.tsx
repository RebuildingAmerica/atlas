import { Button } from "@rebuildingamerica/atlas-ui/ui/button";

interface PublicDataFailureProps {
  onRetry: () => void;
}

/** Public-page recovery when the server and browser fetch both failed. */
export function PublicDataFailure({ onRetry }: PublicDataFailureProps) {
  return (
    <section role="alert" className="mx-auto max-w-3xl px-4 py-12 text-center">
      <h1 className="type-headline-small text-ink-strong">This page didn&rsquo;t load</h1>
      <p className="type-body-medium text-ink-soft mt-2">
        We couldn&rsquo;t get the latest information. Your other Atlas pages still work.
      </p>
      <Button className="mt-5" onClick={onRetry}>
        Try again
      </Button>
    </section>
  );
}
