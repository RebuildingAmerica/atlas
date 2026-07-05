import { Mail } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

interface SignInEmailFormProps {
  domainSuggestion: string | null;
  email: string;
  isEmailFallbackVisible: boolean;
  isPending: boolean;
  onEmailChange: (value: string) => void;
  onRevealEmailFallback: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  passkeyAction?: ReactNode;
}

/**
 * Username field for the passkey-first sign-in flow. The email fallback stays
 * collapsed so it remains an escape hatch instead of competing with passkeys.
 */
export function SignInEmailForm({
  domainSuggestion,
  email,
  isEmailFallbackVisible,
  isPending,
  onEmailChange,
  onRevealEmailFallback,
  onSubmit,
  passkeyAction,
}: SignInEmailFormProps) {
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={onEmailChange}
        placeholder="you@example.com"
        autoComplete="username webauthn"
        required
        icon={<Mail className="h-4 w-4" />}
      />

      {domainSuggestion ? (
        <p className="type-body-small text-outline" aria-live="polite">
          Did you mean{" "}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => {
              onEmailChange(domainSuggestion);
            }}
          >
            {domainSuggestion}
          </button>
          ?
        </p>
      ) : null}

      <div className="space-y-3 pt-1">
        {passkeyAction}

        <div className="pt-1">
          {isEmailFallbackVisible ? (
            <Button
              type="submit"
              variant="secondary"
              className="min-h-10 px-4"
              disabled={isPending || !email.trim()}
            >
              {isPending ? "Sending..." : "Continue with email"}
            </Button>
          ) : (
            <button
              type="button"
              className="type-label-medium text-outline hover:text-on-surface cursor-pointer"
              onClick={onRevealEmailFallback}
            >
              Can't use a passkey?
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
