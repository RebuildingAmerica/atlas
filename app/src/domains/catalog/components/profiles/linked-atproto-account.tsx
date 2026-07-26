import { AtSign } from "lucide-react";
import {
  MONTH_YEAR,
  formatDateTimeOrNull,
  useDateTimeFormatter,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

interface LinkedAtprotoAccountProps {
  entry: Entry;
}

export function LinkedAtprotoAccount({ entry }: LinkedAtprotoAccountProps) {
  const formatDateTime = useDateTimeFormatter();
  const handle = entry.claim.linked_atproto_handle;
  if (entry.claim.linked_atproto_status === "needs_attention") {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="type-label-small text-ink-muted">ATProto identity</span>
        <span className="type-body-small text-ink-soft">Needs attention</span>
      </span>
    );
  }
  if (!handle) {
    return null;
  }
  const verifiedAt = formatDateTimeOrNull(
    formatDateTime,
    entry.claim.linked_atproto_verified_at,
    MONTH_YEAR,
  );

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="type-label-small text-ink-muted">
        {entry.type === "organization" ? "Representative ATProto account" : "ATProto account"}
      </span>
      <span className="type-body-small text-ink-soft inline-flex items-center gap-1.5">
        <AtSign className="text-ink-muted h-3.5 w-3.5" aria-hidden />
        {handle}
      </span>
      {verifiedAt ? (
        <span className="type-label-small text-ink-muted">Verified {verifiedAt}</span>
      ) : null}
    </span>
  );
}
