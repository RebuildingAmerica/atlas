/**
 * ProfileStats — four-up stats panel.
 *
 * Replaces the old `FactRail` for profile detail pages. Numbers render in
 * tabular mono with a smaller Public Sans unit label so each tile reads as a
 * weighed measurement, not decoration. Heavy 2px civic top rule + 1px taupe
 * panel borders mark this as the "data" block in the editorial stack.
 */
import type { ReactNode } from "react";

interface ProfileStatsProps {
  items: ProfileStatItem[];
}

export interface ProfileStatItem {
  label: string;
  value: ReactNode;
  unit?: string;
}

export function ProfileStats({ items }: ProfileStatsProps) {
  return (
    <section
      aria-label="Coverage statistics"
      className="border-border-taupe border-t-ink-strong bg-surface-container-lowest grid grid-cols-2 border border-t-[2px] sm:grid-cols-4"
    >
      {items.map((item, idx) => (
        <div
          key={item.label}
          className={
            "px-5 py-4 sm:px-6 " +
            (idx > 0 ? "sm:border-l-border-taupe sm:border-l" : "") +
            (idx >= 2 ? "border-t-border-taupe border-t sm:border-t-0" : "")
          }
        >
          <div className="type-editorial-stat text-ink-strong">
            {item.value}
            {item.unit ? (
              <span className="text-ink-soft ml-1.5 font-sans text-xs font-medium tracking-normal">
                {item.unit}
              </span>
            ) : null}
          </div>
          <div className="type-editorial-eyebrow text-ink-soft mt-2 uppercase">{item.label}</div>
        </div>
      ))}
    </section>
  );
}
