import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import {
  AdminIndicatorCard,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
  type AdminIndicatorTone,
} from "./admin-portal";
import { cn } from "@/lib/utils";
import type {
  CloudCostGuardrail,
  CloudCostPosture,
  CloudCostPostureResponse,
} from "./cloud-costs.functions";

export function CloudCostsView({ posture }: { posture: CloudCostPostureResponse }) {
  const monthlyProjection = posture.discovery_spend.estimated_daily_usd * 30;
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge={statusLabel(posture.posture)}
        title="Cloud costs"
        description="Operator view for infrastructure cost posture and free-tier guardrails."
      >
        <div className="border-border bg-surface-container-lowest rounded-lg border px-4 py-3">
          <p className="type-label-small text-ink-muted">Updated</p>
          <p className="type-body-small text-ink-strong">{formatDateTime(posture.generated_at)}</p>
        </div>
      </AdminPageHeader>

      <section className="grid gap-4 md:grid-cols-3">
        <AdminIndicatorCard
          label="Discovery spend"
          value={formatUsd(posture.discovery_spend.estimated_daily_usd)}
          detail={`${formatUsd(posture.discovery_spend.daily_ceiling_usd)} daily ceiling`}
          tone={postureTone(posture.discovery_spend.posture)}
        />
        <AdminIndicatorCard
          label="30-day projection"
          value={formatUsd(monthlyProjection)}
          detail="Discovery ledger estimate"
          tone="neutral"
        />
        <AdminIndicatorCard
          label="Per-run ceiling"
          value={formatUsd(posture.discovery_spend.run_ceiling_usd)}
          detail={posture.discovery_spend.kill_switch_enabled ? "Kill switch enabled" : "Active"}
          tone={posture.discovery_spend.kill_switch_enabled ? "block" : "pass"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <article className="border-border bg-surface-container-lowest rounded-lg border p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="type-title-large text-ink-strong">Guardrails</h2>
            <p className="type-label-small text-ink-muted">{posture.guardrails.length} checks</p>
          </div>
          <div className="divide-border divide-y">
            {posture.guardrails.map((guardrail) => (
              <GuardrailRow key={guardrail.id} guardrail={guardrail} />
            ))}
          </div>
        </article>

        <article className="border-border bg-surface-container-lowest rounded-lg border p-5">
          <h2 className="type-title-large text-ink-strong">Accounting gaps</h2>
          <div className="mt-4 space-y-4">
            <ConnectionStatus
              label="Cloud Billing export"
              detail={posture.billing_export.detail}
              status={posture.billing_export.status}
            />
            <ConnectionStatus
              label="External fixed costs"
              detail={posture.external_fixed_costs.detail}
              status={posture.external_fixed_costs.status}
            />
          </div>
        </article>
      </section>
    </AdminPageShell>
  );
}

function GuardrailRow({ guardrail }: { guardrail: CloudCostGuardrail }) {
  const Icon = guardrail.posture === "pass" ? CheckCircle2 : AlertTriangle;
  return (
    <div className="flex gap-3 py-4">
      <Icon className={guardrailIconClassName(guardrail.posture)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="type-title-small text-ink-strong">{guardrail.label}</p>
          <AdminStatusBadge tone={postureTone(guardrail.posture)} compact>
            {statusLabel(guardrail.posture)}
          </AdminStatusBadge>
        </div>
        <p className="type-body-small text-ink-soft mt-1">{guardrail.detail}</p>
      </div>
    </div>
  );
}

function ConnectionStatus({
  detail,
  label,
  status,
}: {
  detail: string;
  label: string;
  status: string;
}) {
  return (
    <div className="border-border rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <CircleHelp className="text-ink-soft h-4 w-4" aria-hidden />
        <p className="type-title-small text-ink-strong">{label}</p>
      </div>
      <p className="type-label-small text-ink-muted mt-2">{formatConnectionStatus(status)}</p>
      <p className="type-body-small text-ink-soft mt-1">{detail}</p>
    </div>
  );
}

function guardrailIconClassName(posture: CloudCostPosture) {
  const base = "mt-0.5 h-5 w-5 shrink-0";
  if (posture === "pass") {
    return cn(base, "text-emerald-600");
  }
  if (posture === "warn") {
    return cn(base, "text-yellow-600");
  }
  return cn(base, "text-red-600");
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatConnectionStatus(status: string) {
  if (status === "connected") {
    return "Connected";
  }
  if (status === "not_configured") {
    return "Not configured";
  }
  return "Not connected";
}

function postureTone(posture: CloudCostPosture): AdminIndicatorTone {
  if (posture === "pass") {
    return "pass";
  }
  if (posture === "warn") {
    return "warn";
  }
  return "block";
}

function statusLabel(posture: CloudCostPosture) {
  if (posture === "pass") {
    return "Pass";
  }
  if (posture === "warn") {
    return "Needs attention";
  }
  return "Blocked";
}
