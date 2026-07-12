import { AtSign } from "lucide-react";
import type { Entry } from "@/types";

interface LinkedAtprotoAccountProps {
  entry: Entry;
}

export function LinkedAtprotoAccount({ entry }: LinkedAtprotoAccountProps) {
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
  const verifiedAt = formatVerifiedAt(entry.claim.linked_atproto_verified_at);

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

function formatVerifiedAt(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
