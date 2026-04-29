import { Button } from "@/platform/ui/button";
import { DevMailCaptureBanner } from "../dev-mail-capture-banner";

function formatExpiryCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface SignUpSentPanelProps {
  captureMailboxUrl: string | null;
  email: string;
  isResending: boolean;
  isTeamSso: boolean;
  resendStatus: string | null;
  secondsUntilExpiry: number;
  secondsUntilResend: number;
  onResend: () => void;
  onUseDifferentEmail: () => void;
}

/**
 * Confirmation surface shown after Atlas sends the sign-up magic link.
 * Counts the link's TTL down, exposes a Resend button gated by the
 * cool-down, and reassures the operator that opening the link on a
 * different device is fine.
 */
export function SignUpSentPanel({
  captureMailboxUrl,
  email,
  isResending,
  isTeamSso,
  resendStatus,
  secondsUntilExpiry,
  secondsUntilResend,
  onResend,
  onUseDifferentEmail,
}: SignUpSentPanelProps) {
  const expiryLabel =
    secondsUntilExpiry > 0
      ? `Link expires in ${formatExpiryCountdown(secondsUntilExpiry)}`
      : "Link expired — request a new one below.";
  const resendLabel = isResending
    ? "Resending..."
    : secondsUntilResend > 0
      ? `Resend in ${String(secondsUntilResend)}s`
      : "Resend link";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">
          {isTeamSso ? "Atlas Team" : "Create your account"}
        </p>
        <h1 className="type-display-small text-on-surface">Check your inbox</h1>
        <p className="type-body-large text-outline">
          We sent a sign-up link to <span className="text-on-surface font-medium">{email}</span>.
        </p>
      </div>

      <div className="border-outline-variant rounded-2xl border px-4 py-3">
        <p className="type-body-medium text-on-surface" aria-live="polite">
          {expiryLabel}
        </p>
      </div>

      {captureMailboxUrl ? <DevMailCaptureBanner url={captureMailboxUrl} /> : null}

      <div className="space-y-2">
        <Button
          variant="secondary"
          disabled={secondsUntilResend > 0 || isResending}
          onClick={onResend}
        >
          {resendLabel}
        </Button>
        {resendStatus ? (
          <p className="type-body-small text-outline" aria-live="polite">
            {resendStatus}
          </p>
        ) : null}
      </div>

      <p className="type-body-medium text-outline">
        Opening the link on a different device is fine — once you sign in there, you can close this
        tab. If you click the link on this device, this page will continue automatically.
      </p>

      <button
        type="button"
        className="type-label-medium text-accent hover:underline"
        onClick={onUseDifferentEmail}
      >
        Use a different email
      </button>
    </div>
  );
}
