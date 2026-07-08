import { AtSign } from "lucide-react";
import type { Entry } from "@/types";

interface LinkedAtprotoAccountProps {
  entry: Entry;
}

export function LinkedAtprotoAccount({ entry }: LinkedAtprotoAccountProps) {
  const handle = entry.claim.linked_atproto_handle;
  if (!handle) {
    return null;
  }
  const verifiedAt = formatVerifiedAt(entry.claim.linked_atproto_verified_at);

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="type-label-small text-ink-muted">
        {entry.type === "organization" ? "Representative ATProto account" : "ATProto account"}
      </span>
      <a
        href={atprotoProfileUrl(handle)}
        target="_blank"
        rel="noreferrer"
        className="type-body-small text-ink-soft hover:text-ink-strong inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
      >
        <AtSign className="text-ink-muted h-3.5 w-3.5" aria-hidden />
        {handle}
      </a>
      {verifiedAt ? (
        <span className="type-label-small text-ink-muted">Verified {verifiedAt}</span>
      ) : null}
    </span>
  );
}

function atprotoProfileUrl(handle: string): string {
  return `https://bsky.app/profile/${encodeURIComponent(handle.trim().replace(/^@/, ""))}`;
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
