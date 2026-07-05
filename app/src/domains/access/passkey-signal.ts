/**
 * Tells a supporting browser's credential store that a passkey no longer
 * exists server-side, via the WebAuthn Signal API. Best-effort: browsers
 * without support, or a rejected call, are silently ignored — this is
 * hygiene cleanup, never a required step in any auth or account flow.
 */
export function signalUnknownPasskey(credentialId: string): void {
  if (
    typeof PublicKeyCredential === "undefined" ||
    typeof PublicKeyCredential.signalUnknownCredential !== "function"
  ) {
    return;
  }

  void PublicKeyCredential.signalUnknownCredential({
    rpId: window.location.hostname,
    credentialId,
  }).catch(() => {
    return;
  });
}
