import { CheckCircle2 } from "lucide-react";

export interface AccountSetupChecklistItem {
  complete: boolean;
  description: string;
  kind: "required" | "recommended";
  title: string;
}

interface AccountSetupChecklistProps {
  checklist: readonly AccountSetupChecklistItem[];
  lastCheckedLabel: string | null;
}

/**
 * Header progress card plus the per-step checklist for the account-
 * setup surface.  Renders the "X of Y required steps complete" line,
 * a live "Last checked Ns ago" timestamp, and a card per checklist
 * item with its required/recommended chip and Done/Pending badge.
 */
export function AccountSetupChecklist({ checklist, lastCheckedLabel }: AccountSetupChecklistProps) {
  const requiredCompleteCount = checklist.filter(
    (item) => item.kind === "required" && item.complete,
  ).length;
  const requiredTotal = checklist.filter((item) => item.kind === "required").length;
  const allComplete = checklist.every((item) => item.complete);

  return (
    <>
      <div className="border-border bg-surface-container-lowest flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border px-5 py-3">
        <div>
          <p className="type-label-medium text-ink-muted">Progress</p>
          <p className="type-title-small text-ink-strong">
            {requiredCompleteCount} of {requiredTotal} required step
            {requiredTotal === 1 ? "" : "s"} complete
            {allComplete ? " — passkey added too" : ""}
          </p>
        </div>
        {lastCheckedLabel ? (
          <p className="type-body-small text-ink-soft" aria-live="polite">
            Last checked {lastCheckedLabel}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        {checklist.map((item) => (
          <article
            key={item.title}
            className="border-border rounded-[1.4rem] border bg-white/70 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="type-title-small text-ink-strong">{item.title}</p>
                  {item.kind === "recommended" ? (
                    <span className="type-label-small text-ink-soft border-border rounded-full border px-2 py-0.5">
                      Recommended
                    </span>
                  ) : null}
                </div>
                <p className="type-body-medium text-ink-soft">{item.description}</p>
              </div>
              <span
                className={
                  item.complete
                    ? "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                    : "border-border text-ink-soft inline-flex items-center gap-1 rounded-full border px-3 py-1"
                }
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {item.complete ? "Done" : item.kind === "recommended" ? "Optional" : "Pending"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
