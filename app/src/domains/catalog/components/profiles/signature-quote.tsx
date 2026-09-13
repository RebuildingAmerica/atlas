/**
 * SignatureQuote — Libre Baskerville pull-quote panel.
 *
 * Pulls the first source-attached extraction context, renders it as an italic
 * quote in the editorial serif, and credits the publication and date. Returns
 * null when no quote-bearing source is available so the panel doesn't appear
 * for thin profiles.
 *
 * A context identical to the profile's own description is not a quote. Records
 * built from structured filings, such as an officer listed on an IRS Form 990,
 * carry an Atlas-written sentence as both, and showing it in quotation marks
 * credited to the publication would attribute Atlas's words to that source.
 */
import {
  MONTH_YEAR,
  formatDateTimeOrInput,
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

  // `published_date` is a calendar day, so the credit line stays pinned to UTC
  // rather than sliding a source into the previous month for western readers.
  // Every packet carries an ingestion time, so the credit line always has a
  // date to stand on even when the publisher gave none.
  const quotedAt = source.published_date ?? source.ingested_at;
  const dateLabel = formatDateTimeOrInput(formatStableDateTime, quotedAt, MONTH_YEAR);
  const sourceIndex = sources.indexOf(source) + 1;

  return (
    <section
      className="border-border-taupe bg-paper-deep border px-6 py-6 sm:px-8"
      aria-labelledby="signature-quote-heading"
    >
      <h2 id="signature-quote-heading" className="sr-only">
        Signature quote from coverage
      </h2>
      <blockquote className="type-editorial-quote text-ink-strong max-w-3xl">
        <span aria-hidden>&ldquo;</span>
        {source.extraction_context}
        <span aria-hidden>&rdquo;</span>
      </blockquote>
      <p className="text-ink-soft mt-3 font-sans text-xs font-semibold tracking-[0.08em] uppercase">
        {source.publication ? (
          <span className="text-ink-strong italic">{source.publication}</span>
        ) : (
          <span className="text-ink-strong italic">Atlas coverage</span>
        )}
        <span> &middot; {dateLabel}</span>
        <span>
          {" "}
          &middot; Source {String(sourceIndex).padStart(2, "0")} of {sources.length}
        </span>
      </p>
    </section>
  );
}
