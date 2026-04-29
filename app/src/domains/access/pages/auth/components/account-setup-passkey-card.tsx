import { ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@/platform/ui/button";

interface AccountSetupPasskeyCardProps {
  emailVerified: boolean;
  errorMessage: string | null;
  isAddPending: boolean;
  isContinuingWithoutPasskey: boolean;
  onAddPasskey: () => void;
  onContinueWithoutPasskey: () => void;
}

/**
 * Card promoting passkey enrollment as the recommended next step after
 * email verification.  Surfaces the "What's a passkey?" disclosure with
 * Atlas's plain-language explanation of phishing-resistant credentials,
 * and exposes the "Continue without a passkey" escape hatch once email
 * verification has cleared.
 */
export function AccountSetupPasskeyCard({
  emailVerified,
  errorMessage,
  isAddPending,
  isContinuingWithoutPasskey,
  onAddPasskey,
  onContinueWithoutPasskey,
}: AccountSetupPasskeyCardProps) {
  return (
    <div
      className={
        emailVerified
          ? "rounded-[1.4rem] border-2 border-blue-300 bg-blue-50/50 p-5"
          : "border-border bg-surface-container-lowest rounded-[1.4rem] border p-5"
      }
    >
      <p className="type-title-small text-ink-strong">
        {emailVerified ? "Almost there — add a passkey or skip" : "Add a passkey"}
      </p>
      <p className="type-body-medium text-ink-soft mt-2">
        Passkeys let you sign in instantly with the same Touch ID, Face ID, Windows Hello, or
        hardware security key you already use elsewhere — no password to remember and no email link
        to wait on. You can also keep using magic links and add a passkey later.
      </p>
      <details className="mt-3">
        <summary className="type-label-medium text-accent cursor-pointer hover:underline">
          What's a passkey?
        </summary>
        <div className="type-body-small text-ink-soft mt-2 space-y-2 leading-relaxed">
          <p>
            A passkey is a credential that lives on your device or hardware key. It uses your
            fingerprint, face, or device PIN to authorize sign-in instead of typing anything.
          </p>
          <p>
            Passkeys are phishing-resistant — they only work on the real Atlas origin — and Atlas
            never sees the underlying biometric. Your device stores the secret half of the
            credential; Atlas only stores the public half.
          </p>
          <p>
            Most modern browsers and operating systems support passkeys: Safari/macOS, Chrome and
            Edge on Windows, iOS, and Android. Hardware security keys (YubiKey, Titan, etc.) work
            too.
          </p>
        </div>
      </details>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant={emailVerified ? "primary" : "secondary"}
          disabled={isAddPending}
          onClick={onAddPasskey}
        >
          <span className="inline-flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            {isAddPending ? "Adding passkey..." : "Add a passkey"}
          </span>
        </Button>
        {emailVerified ? (
          <Button
            variant="secondary"
            disabled={isContinuingWithoutPasskey}
            onClick={onContinueWithoutPasskey}
          >
            <span className="inline-flex items-center gap-2">
              {isContinuingWithoutPasskey ? "Continuing..." : "Continue without a passkey"}
              <ArrowRight className="h-4 w-4" />
            </span>
          </Button>
        ) : null}
        {errorMessage ? <p className="type-body-medium text-red-700">{errorMessage}</p> : null}
      </div>
      <p className="type-body-small text-ink-soft mt-3">
        You can add or replace a passkey anytime from your account settings.
      </p>
    </div>
  );
}
