/**
 * Common email-domain spellings Atlas suggests when an operator's typed
 * domain looks like a near-miss.  The list intentionally stays small and
 * targets the highest-traffic typo cases — Gmail, Outlook, Yahoo,
 * iCloud, ProtonMail — instead of trying to be exhaustive.
 */
const COMMON_EMAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "fastmail.com",
  "aol.com",
] as const;

const SUGGESTION_DISTANCE_THRESHOLD = 2;

/**
 * Returns the Levenshtein edit distance between two non-empty strings,
 * used to decide when a typed domain is close enough to a known one to
 * suggest a correction (e.g. `gmial.com` → `gmail.com`).  Callers must
 * filter out empty strings and exact matches before invoking.
 */
function levenshteinDistance(left: string, right: string): number {
  // The DP row is always populated for indices 0..right.length before we
  // read it.  The `?? 0` clauses below preserve TypeScript's strict
  // index-access typing without changing runtime behavior — the
  // right-hand side is unreachable for the only indices we ever touch.
  const previous: number[] = [];
  for (let i = 0; i <= right.length; i++) {
    previous.push(i);
  }
  for (let i = 1; i <= left.length; i++) {
    let deleteCost = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const stored = previous[j] ?? 0;
      const cost = left.charCodeAt(i - 1) === right.charCodeAt(j - 1) ? 0 : 1;
      const insertion = (previous[j] ?? 0) + 1;
      const deletion = (previous[j - 1] ?? 0) + 1;
      const substitution = deleteCost + cost;
      previous[j] = Math.min(insertion, deletion, substitution);
      deleteCost = stored;
    }
  }
  return previous[right.length] ?? 0;
}

/**
 * Returns a "did you mean…" suggestion for the email's domain when the
 * typed value is close to a known consumer-mailbox host but not exactly
 * one.  Returns null when the address looks fine, when there is no
 * recognisable domain, or when the closest match is too far away to be
 * a confident correction.
 *
 * @param email - The candidate email the operator typed.
 */
export function suggestEmailDomainCorrection(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf("@");
  if (atIndex < 0 || atIndex === trimmed.length - 1) {
    return null;
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (!domain || COMMON_EMAIL_DOMAINS.includes(domain)) {
    return null;
  }
  let bestMatch: string | null = null;
  let bestDistance = SUGGESTION_DISTANCE_THRESHOLD + 1;
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const distance = levenshteinDistance(domain, candidate);
    if (distance > 0 && distance <= SUGGESTION_DISTANCE_THRESHOLD && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }
  if (!bestMatch) {
    return null;
  }
  return `${local}@${bestMatch}`;
}
