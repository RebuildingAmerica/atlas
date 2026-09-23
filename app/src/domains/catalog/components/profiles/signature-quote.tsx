/**
 * SignatureQuote — source context panel.
 *
 * Extraction context may be a paraphrase, not the publisher's exact words.
 * Present it as a source note without quotation marks or a fabricated
 * publication date. Returns null when no useful context is available.
 *
 * A context identical to the profile's own description is not a quote. Records
 * built from structured filings, such as an officer listed on an IRS Form 990,
 * carry an Atlas-written sentence as both, and showing it in quotation marks
 * credited to the publication would attribute Atlas's words to that source.
 */
import {
  MONTH_YEAR,
  formatDateTimeOrNull,
  formatStableDateTime,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import type { Source } from "@rebuildingamerica/atlas-api-client";

interface SignatureQuoteProps {
  sources: Source[];
  /** The profile's own description, which a quote must not merely repeat. */
  description?: string | null;
}

function findQuoteSource(sources: Source[], description: string): Source | null {
  return (
    sources.find((source) => {
      const context = source.extraction_context?.trim();
      return Boolean(context) && context !== description;
    }) ?? null
  );
}

export function SignatureQuote({ sources, description }: SignatureQuoteProps) {
  const source = findQuoteSource(sources, description?.trim() ?? "");
  if (!source) return null;

  const dateLabel = formatDateTimeOrNull(formatStableDateTime, source.published_date, MONTH_YEAR);
  const sourceIndex = sources.indexOf(source) + 1;

  return (
    <section
      className="border-border-taupe bg-paper-deep border px-6 py-6 sm:px-8"
      aria-labelledby="signature-quote-heading"
    >
      <h2 id="signature-quote-heading" className="type-label-small text-ink-muted">
        Source context
      </h2>
      <p className="type-body-medium text-ink-strong mt-3 max-w-3xl">{source.extraction_context}</p>
      <p className="text-ink-soft mt-3 font-sans text-xs font-semibold tracking-[0.08em] uppercase">
        {source.publication ? (
          <span className="text-ink-strong italic">{source.publication}</span>
        ) : (
          <span className="text-ink-strong italic">Source</span>
        )}
        {dateLabel ? <span> &middot; Published {dateLabel}</span> : null}
        <span>
          {" "}
          &middot; Source {String(sourceIndex).padStart(2, "0")} of {sources.length}
        </span>
      </p>
    </section>
  );
}
