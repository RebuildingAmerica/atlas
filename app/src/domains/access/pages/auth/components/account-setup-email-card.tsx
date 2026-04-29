import { Mail } from "lucide-react";
import { Button } from "@/platform/ui/button";

interface AccountSetupEmailCardProps {
  email: string;
  isError: boolean;
  isPending: boolean;
  isSent: boolean;
  onSend: () => void;
}

/**
 * Card prompting the operator to send (or resend) their email
 * verification message.  Used during account setup before Atlas
 * grants resource-creation access.
 */
export function AccountSetupEmailCard({
  email,
  isError,
  isPending,
  isSent,
  onSend,
}: AccountSetupEmailCardProps) {
  return (
    <div className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-5">
      <p className="type-title-small text-ink-strong">Verify your email</p>
      <p className="type-body-medium text-ink-soft mt-2">
        We&apos;ll send a verification link to {email}. After you open it, come back here — Atlas
        refreshes your status automatically.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={isPending} onClick={onSend}>
          <span className="inline-flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {isPending ? "Sending verification..." : "Send verification email"}
          </span>
        </Button>
        {isSent ? <p className="type-body-medium text-ink-soft">Verification email sent.</p> : null}
        {isError ? (
          <p className="type-body-medium text-red-700">
            Atlas could not send the verification email right now.
          </p>
        ) : null}
      </div>
    </div>
  );
}
