import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { CIVIC_NAVY, darken } from "@/domains/catalog/map/marker-style";
import { FALLBACK_ISSUE_COLOR } from "@/domains/catalog/map/issue-colors";

/** One trust tier's swatch and the honest sentence describing it. */
interface TrustRow {
  /** A short, accessible name for the swatch. */
  swatch: "verified" | "corroborated" | "unverified";
  description: string;
}

/** The trust tiers in the same never-overclaiming order the dot rings use. */
const TRUST_ROWS: TrustRow[] = [
  { swatch: "verified", description: "Verified by Atlas or the subject" },
  { swatch: "corroborated", description: "Corroborated across sources" },
  { swatch: "unverified", description: "Unverified — shown quietly" },
];

/** A small dot drawn the way a marker of that trust tier would read on the map. */
function TrustSwatch({ swatch }: { swatch: TrustRow["swatch"] }) {
  if (swatch === "verified") {
    return (
      <span
        className="block h-3 w-3 rounded-full"
        style={{ backgroundColor: FALLBACK_ISSUE_COLOR, boxShadow: `0 0 0 1.5px ${CIVIC_NAVY}` }}
        aria-hidden
      />
    );
  }
  if (swatch === "corroborated") {
    return (
      <span
        className="block h-3 w-3 rounded-full"
        style={{
          backgroundColor: FALLBACK_ISSUE_COLOR,
          boxShadow: `0 0 0 1.5px ${darken(FALLBACK_ISSUE_COLOR, 0.35)}`,
        }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className="block h-3 w-3 rounded-full"
      style={{ backgroundColor: FALLBACK_ISSUE_COLOR, opacity: 0.8 }}
      aria-hidden
    />
  );
}

/**
 * The map's bottom-left legend — collapsed by default, expandable on demand.
 *
 * The map should be legible the instant it loads, so the legend stays out of
 * the way until a visitor wants it; opening it explains the one thing the dots
 * encode that isn't self-evident — the trust ring — in the same honest language
 * the browse cards and profiles use, so "no ring" reads as deliberate silence
 * rather than missing data. It is a plain disclosure: a focusable toggle whose
 * `aria-expanded` tracks the open panel.
 */
export function MapLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-surface-container-high/92 shadow-soft border-border-strong pointer-events-auto rounded-[0.9rem] border backdrop-blur-md">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="type-label-large text-ink-soft hover:text-ink-strong flex items-center gap-1.5 px-3 py-2 transition-colors"
      >
        <Info className="h-4 w-4" aria-hidden />
        Legend
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="space-y-1.5 px-3 pb-3">
          {TRUST_ROWS.map((row) => (
            <li key={row.swatch} className="flex items-center gap-2">
              <TrustSwatch swatch={row.swatch} />
              <span className="type-body-small text-ink-soft">{row.description}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
