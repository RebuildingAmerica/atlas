import {
  formatDateTimeOrNull,
  NUMERIC_DATE_TIME,
  useDateTimeFormatter,
} from "@rebuildingamerica/atlas-ui/format/date-time";

/**
 * Props for the invitation expiry line.
 */
interface InvitationExpiryProps {
  expiresAt: string | null;
}

/**
 * States when an invitation stops working, in the reader's own clock.
 *
 * An invitation whose record carries no usable expiry renders nothing at all --
 * a deadline the workspace cannot vouch for is worse than no deadline shown.
 *
 * @param props - The invitation's stored expiry timestamp, if it has one.
 * @returns The expiry line, or nothing when there is no real timestamp.
 */
export function InvitationExpiry({ expiresAt }: InvitationExpiryProps) {
  const formatDateTime = useDateTimeFormatter();
  const expires = formatDateTimeOrNull(formatDateTime, expiresAt, NUMERIC_DATE_TIME);

  if (expires === null) {
    return null;
  }

  return <p className="type-body-small text-ink-muted">Expires {expires}</p>;
}
