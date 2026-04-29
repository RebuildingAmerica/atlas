import { Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

interface SignUpFormPanelProps {
  effectiveRedirect: string | undefined;
  email: string;
  errorMessage: string | null;
  isPending: boolean;
  isTeamSso: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * Initial sign-up surface — eyebrow + heading + subhead, the email
 * input and submit button, the sign-in link, and the team-SSO call-out
 * shown to non-team-intent visitors.
 */
export function SignUpFormPanel({
  effectiveRedirect,
  email,
  errorMessage,
  isPending,
  isTeamSso,
  onEmailChange,
  onSubmit,
}: SignUpFormPanelProps) {
  const eyebrow = isTeamSso ? "Atlas Team" : "Create your account";
  const heading = isTeamSso ? "Set up SSO for your team" : "Join Atlas";
  const subhead = isTeamSso
    ? "Create your account, then choose Atlas Team and configure your identity provider. Free to start; pay only when you confirm the team plan."
    : "Enter your email and we'll send you a link to get started. Free to join.";
  const ctaCopy = isPending
    ? "Creating account..."
    : isTeamSso
      ? "Continue with team setup"
      : "Create account";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">{eyebrow}</p>
        <h1 className="type-display-small text-on-surface">{heading}</h1>
        <p className="type-body-large text-outline">{subhead}</p>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={onEmailChange}
          placeholder="you@example.com"
          autoComplete="email"
          required
          icon={<Mail className="h-4 w-4" />}
        />

        <Button type="submit" disabled={isPending || !email.trim()}>
          {ctaCopy}
        </Button>
      </form>

      {errorMessage ? (
        <p className="type-body-medium rounded-2xl bg-red-50 px-4 py-3 text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <p className="type-body-medium text-outline">
        Already have an account?{" "}
        <Link
          to="/sign-in"
          search={effectiveRedirect ? { redirect: effectiveRedirect } : undefined}
          className="text-accent type-label-medium hover:underline"
        >
          Sign in &rarr;
        </Link>
      </p>

      {!isTeamSso ? (
        <div className="border-outline-variant rounded-2xl border px-4 py-3">
          <p className="type-body-small text-outline">
            Setting up SSO for your team?{" "}
            <Link
              to="/sign-up"
              search={{ intent: "team-sso" }}
              className="text-accent type-label-small hover:underline"
            >
              Start the team plan &rarr;
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
