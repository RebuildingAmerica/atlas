import { KeyRound } from "lucide-react";
import { Button } from "@/platform/ui/button";

interface SignInPasskeyButtonProps {
  isLastUsed: boolean;
  isPending: boolean;
  onClick: () => void;
}

/**
 * Primary passkey sign-in CTA with the floating "Last used" badge that
 * surfaces when this user's most recent successful sign-in was via
 * passkey.  The badge nudges returning users back to the same method.
 */
export function SignInPasskeyButton({ isLastUsed, isPending, onClick }: SignInPasskeyButtonProps) {
  return (
    <div className="relative inline-block">
      <Button onClick={onClick} disabled={isPending}>
        <span className="inline-flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          {isPending ? "Waiting for passkey..." : "Sign in with passkey"}
        </span>
      </Button>
      {isLastUsed ? (
        <span className="type-label-small bg-inverse-surface text-inverse-on-surface absolute -top-2 -right-2 rounded-full px-1.5 py-0.5">
          Last used
        </span>
      ) : null}
    </div>
  );
}
