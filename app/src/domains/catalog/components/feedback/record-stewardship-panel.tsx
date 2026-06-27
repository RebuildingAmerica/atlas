import { CalendarClock, FileText, Link2 } from "lucide-react";

interface StewardshipSignal {
  description: string;
  icon: typeof Link2;
  label: string;
}

const STEWARDSHIP_SIGNALS: StewardshipSignal[] = [
  {
    description: "Link to the clearest public evidence for the change.",
    icon: Link2,
    label: "Public source",
  },
  {
    description: "Name the field or claim that should be updated.",
    icon: FileText,
    label: "Exact change",
  },
  {
    description: "Add dates when the information changed or appeared.",
    icon: CalendarClock,
    label: "Timing",
  },
];

/**
 * Guidance shown on correction pages so contributors can send updates that
 * strengthen the public record without adding a heavier workflow.
 */
export function RecordStewardshipPanel() {
  return (
    <section
      aria-label="Record stewardship"
      className="border-border bg-surface-container-lowest rounded-[1rem] border px-4 py-4"
    >
      <div className="space-y-1">
        <p className="type-label-small text-ink-muted uppercase">Record stewardship</p>
        <h2 className="type-title-medium text-ink-strong">What makes an update useful</h2>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {STEWARDSHIP_SIGNALS.map((signal) => {
          const Icon = signal.icon;
          return (
            <article
              key={signal.label}
              className="border-border bg-surface rounded-[0.85rem] border px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <Icon className="text-accent h-4 w-4" aria-hidden />
                <p className="type-label-large text-ink-strong">{signal.label}</p>
              </div>
              <p className="type-body-small text-ink-soft mt-1">{signal.description}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
