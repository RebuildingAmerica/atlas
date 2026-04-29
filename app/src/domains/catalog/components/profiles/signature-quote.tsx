/**
 * SignatureQuote — Libre Baskerville pull-quote panel.
 *
 * Pulls the first source-attached extraction context, renders it as an italic
 * quote in the editorial serif, and credits the publication and date. Returns
 * null when no quote-bearing source is available so the panel doesn't appear
 * for thin profiles.
 */
import type { Source } from "@/types";

interface SignatureQuoteProps {
  sources: Source[];
}

function findQuoteSource(sources: Source[]): Source | null {
  return sources.find((source) => source.extraction_context?.trim()) ?? null;
}

function formatQuoteDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function SignatureQuote({ sources }: SignatureQuoteProps) {
  const source = findQuoteSource(sources);
  if (!source) return null;

  const dateLabel = formatQuoteDate(source.published_date ?? source.ingested_at);
  const sourceIndex = sources.indexOf(source) + 1;

  return (
    <section
      className="border-border-taupe bg-paper-deep border px-6 py-6 sm:px-8"
      aria-label="Signature quote from coverage"
    >
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
        {dateLabel ? <span> &middot; {dateLabel}</span> : null}
        <span>
          {" "}
          &middot; Source {String(sourceIndex).padStart(2, "0")} of {sources.length}
        </span>
      </p>
    </section>
  );
}
