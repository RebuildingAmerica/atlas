import { LogOut } from "lucide-react";
import { Button } from "@/platform/ui/button";

interface AccountHeaderProps {
  email: string | undefined;
  isLocal: boolean;
  name: string | null | undefined;
  rpLogoutAvailable: boolean | null;
  onSignOut: () => void;
}

/**
 * Top header row of the account page — name / email block on the left,
 * and (in deployed mode) a Sign out button paired with the RP-Initiated
 * Logout caption that tells the operator whether Atlas will also sign
 * them out of their identity provider.
 */
export function AccountHeader({
  email,
  isLocal,
  name,
  rpLogoutAvailable,
  onSignOut,
}: AccountHeaderProps) {
  return (
    <section className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">Account</p>
        <h1 className="type-headline-large text-on-surface">{name?.trim() || email}</h1>
        <p className="type-body-large text-outline">{email}</p>
      </div>
      {!isLocal ? (
        <div className="flex flex-col items-end gap-1">
          <Button variant="secondary" onClick={onSignOut}>
            <span className="inline-flex items-center gap-2">
              <LogOut className="h-4 w-4" />
              Sign out
            </span>
          </Button>
          {rpLogoutAvailable === true ? (
            <p className="type-body-small text-outline" aria-live="polite">
              Atlas will also sign you out of your identity provider.
            </p>
          ) : rpLogoutAvailable === false ? (
            <p className="type-body-small text-outline" aria-live="polite">
              Your identity provider session may stay active until it expires on its own.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
