function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=(\r\n|\r|\n)/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

/**
 * Returns the first URL-looking token from the provided text.
 *
 * @param value - The email text to scan.
 */
function findFirstUrl(value: string): string | null {
  const match = /https?:\/\/[^\s>"]+/.exec(value);
  if (!match) {
    return null;
  }

  return match[0];
}

/**
 * Extracts the first URL from a captured email body.
 *
 * Atlas's mail capture often stores plain-text URLs directly. We prefer the
 * raw message first because decoding quoted-printable content too early can
 * corrupt legitimate query strings like `?token=db...` into non-URL bytes.
 *
 * @param rawEmail - The raw captured email message.
 */
export function extractFirstUrlFromEmail(rawEmail: string): string {
  const rawUrl = findFirstUrl(rawEmail);
  if (rawUrl && !rawUrl.endsWith("=")) {
    return rawUrl;
  }

  const normalizedEmail = decodeQuotedPrintable(rawEmail);
  const decodedUrl = findFirstUrl(normalizedEmail);
  if (decodedUrl) {
    return decodedUrl;
  }

  throw new Error("Could not find a sign-in URL in the captured email.");
}
