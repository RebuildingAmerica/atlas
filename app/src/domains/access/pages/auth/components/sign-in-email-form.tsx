import { Mail } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

interface SignInEmailFormProps {
  domainSuggestion: string | null;
  email: string;
  isLastUsed: boolean;
  isPending: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * Email-first sign-in form.  Submits an enterprise-SSO probe followed
 * by a magic-link send, with an inline typo-correction prompt and a
 * "Last used" badge that mirrors the passkey CTA when the most recent
 * successful sign-in was via magic link.
 */
export function SignInEmailForm({
  domainSuggestion,
  email,
  isLastUsed,
  isPending,
  onEmailChange,
  onSubmit,
}: SignInEmailFormProps) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
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

      <div className="relative inline-block">
        <Button type="submit" variant="secondary" disabled={isPending || !email.trim()}>
          {isPending ? "Continuing..." : "Continue with email"}
        </Button>
        {isLastUsed ? (
          <span className="type-label-small bg-inverse-surface text-inverse-on-surface absolute -top-2 -right-2 rounded-full px-1.5 py-0.5">
            Last used
          </span>
        ) : null}
      </div>
    </form>
  );
}
