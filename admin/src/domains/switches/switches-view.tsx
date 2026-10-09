import { useState } from "react";
import {
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import {
  MEDIUM_DATE_TIME,
  useDateTimeFormatter,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Textarea } from "@rebuildingamerica/atlas-ui/ui/textarea";
import type {
  PlatformSwitchResponse,
  PlatformSwitchResponseName,
} from "@/generated/platform-schemas";

/** A change the operator asked for. */
export interface SwitchChange {
  engaged: boolean;
  name: PlatformSwitchResponseName;
  reason: string;
}

interface SwitchesViewProps {
  changeMessage?: string;
  errorMessage?: string;
  isLoading: boolean;
  onChange: (change: SwitchChange) => void;
  pendingName?: PlatformSwitchResponseName;
  switches: PlatformSwitchResponse[];
}

interface SwitchCardProps {
  onChange: (change: SwitchChange) => void;
  pending: boolean;
  switch: PlatformSwitchResponse;
}

interface SwitchCopy {
  engage: string;
  engagedEffect: string;
  label: string;
  release: string;
  releasedEffect: string;
}

const SWITCH_COPY: Record<PlatformSwitchResponseName, SwitchCopy> = {
  discovery_spend: {
    engage: "Stop discovery spend",
    engagedEffect: "No discovery run may spend money until this is released.",
    label: "Discovery spend",
    release: "Resume discovery",
    releasedEffect:
      "Discovery runs spend within their daily and per-run ceilings.",
  },
  checkout: {
    engage: "Pause sales",
    engagedEffect:
      "The pricing page tells buyers purchases are paused. Existing subscriptions keep working.",
    label: "Checkout",
    release: "Reopen sales",
    releasedEffect: "Buyers can check out.",
  },
};

/**
 * The fast way to stop money moving when something is wrong, without a
 * release. Each change asks why, and takes effect within a minute.
 */
export function SwitchesView({
  changeMessage,
  errorMessage,
  isLoading,
  onChange,
  pendingName,
  switches,
}: SwitchesViewProps) {
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Platform"
        title="Switches"
        description="Stop discovery spend or pause sales in under a minute, without a release. Every change records who made it and why."
      />
      <AdminInlineStatus message={errorMessage} />
      <AdminInlineStatus message={changeMessage} />
      {isLoading ? (
        <div
          aria-busy
          className="border-border bg-surface-container-lowest h-32 rounded-lg border"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {switches.map((item) => (
            <SwitchCard
              // A new key once the switch actually changes clears the reason;
              // a cancelled or failed change keeps what the operator typed.
              key={`${item.name}:${item.changed_at ?? "never"}`}
              onChange={onChange}
              pending={pendingName === item.name}
              switch={item}
            />
          ))}
        </div>
      )}
    </AdminPageShell>
  );
}

function SwitchCard({ onChange, pending, switch: item }: SwitchCardProps) {
  const [reason, setReason] = useState("");
  const formatDate = useDateTimeFormatter();
  const copy = SWITCH_COPY[item.name];
  const ready = reason.trim().length >= 3 && !pending;

  return (
    <article className="border-border bg-surface-container-lowest space-y-3 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="type-title-medium text-ink-strong">{copy.label}</h2>
        <AdminStatusBadge tone={item.engaged ? "block" : "pass"}>
          {item.engaged ? "Engaged" : "Released"}
        </AdminStatusBadge>
      </div>
      <p className="type-body-small text-ink-soft">
        {item.engaged ? copy.engagedEffect : copy.releasedEffect}
      </p>
      {item.changed_at && item.changed_by ? (
        <p className="type-body-small text-ink-strong">
          Last changed {formatDate(item.changed_at, MEDIUM_DATE_TIME)} by{" "}
          {item.changed_by}: {item.reason}
        </p>
      ) : (
        <p className="type-body-small text-ink-soft">Never changed.</p>
      )}
      <Textarea
        disabled={pending}
        label="Reason"
        onChange={setReason}
        placeholder="What happened, so whoever reads this later understands it"
        rows={2}
        value={reason}
      />
      <Button
        disabled={!ready}
        onClick={() => {
          onChange({
            engaged: !item.engaged,
            name: item.name,
            reason: reason.trim(),
          });
        }}
        variant={item.engaged ? "secondary" : "primary"}
      >
        {item.engaged ? copy.release : copy.engage}
      </Button>
    </article>
  );
}
