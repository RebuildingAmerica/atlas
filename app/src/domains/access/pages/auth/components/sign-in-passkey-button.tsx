import { KeyRound } from "lucide-react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";

interface SignInPasskeyButtonProps {
  isLastUsed: boolean;
  isPending: boolean;
  onClick: () => void;
}

/**
 * Primary passkey sign-in CTA for the auth form, with an in-flow "Last used"
 * badge when this browser's most recent successful sign-in was via passkey.
 */
export function SignInPasskeyButton({ isLastUsed, isPending, onClick }: SignInPasskeyButtonProps) {
  return (
    <div className="space-y-2">
      <Button
        onClick={onClick}
        disabled={isPending}
        className="inline-flex min-h-12 w-full items-center justify-center px-5 py-3"
      >
        <span className="inline-flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          {isPending ? "Waiting for passkey..." : "Sign in with passkey"}
        </span>
      </Button>
      {isLastUsed ? (
        <div>
          <span className="type-label-small border-outline-variant bg-surface-container-low text-outline rounded-full border px-2.5 py-1">
            Last used
          </span>
        </div>
      ) : null}
    </div>
  );
}
