import { LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/platform/ui/button";

interface AccountSetupNextStepCardProps {
  isRefreshing: boolean;
  isSignOutPending: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
}

/**
 * Tail card with the manual "Refresh status" button (so the operator
 * doesn't have to wait for the periodic auto-poll) and a sign-out
 * escape hatch in case they reached this screen on the wrong account.
 */
export function AccountSetupNextStepCard({
  isRefreshing,
  isSignOutPending,
  onRefresh,
  onSignOut,
}: AccountSetupNextStepCardProps) {
  return (
    <div className="border-border bg-surface-container-lowest space-y-4 rounded-[1.4rem] border p-5">
      <div className="space-y-2">
        <p className="type-title-medium text-ink-strong">Next step</p>
        <p className="type-body-medium text-ink-soft">
          Atlas refreshes your status automatically. Use the button below if you'd like to check
          sooner.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={isRefreshing} onClick={onRefresh}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            {isRefreshing ? "Refreshing..." : "Refresh status"}
          </span>
        </Button>

        <Button variant="ghost" disabled={isSignOutPending} onClick={onSignOut}>
          <span className="inline-flex items-center gap-2">
            <LogOut className="h-4 w-4" />
            {isSignOutPending ? "Signing out..." : "Sign out"}
          </span>
        </Button>
      </div>
    </div>
  );
}
