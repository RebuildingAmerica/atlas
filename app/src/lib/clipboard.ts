/**
 * Writes `text` to the system clipboard, returning whether the write
 * succeeded.  Handles the common pitfalls — missing `navigator.clipboard`
 * in non-secure contexts and async `writeText` rejections — so callers
 * don't need to guard each one.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
