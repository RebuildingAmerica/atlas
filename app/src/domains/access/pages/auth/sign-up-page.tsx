import { Link, useNavigate } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useState } from "react";
import { checkAccountExists, requestMagicLink } from "@/domains/access/session.functions";
import { buildSignInCallbackURL } from "./sign-in-page-helpers";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

interface SignUpPageProps {
  redirectTo?: string;
}

/**
 * Sign-up page for new Atlas accounts.
 *
 * Collects an email address and sends a magic link. If the email already has
 * an account, redirects to /sign-in with a notice.
 */
export function SignUpPage({ redirectTo }: SignUpPageProps = {}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const callbackURL = buildSignInCallbackURL(undefined, redirectTo);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setIsPending(true);

    try {
      const accountCheckPromise = checkAccountExists({ data: { email } });
      const accountCheck = await accountCheckPromise;

      if (accountCheck.exists) {
        const navigationPromise = navigate({
          to: "/sign-in",
          search: redirectTo
            ? { email, existing: true, redirect: redirectTo }
            : { email, existing: true },
        });
        await navigationPromise;
        return;
      }

      const magicLinkPromise = requestMagicLink({
        data: { callbackURL, email },
      });
      await magicLinkPromise;

      setStatusMessage("A sign-up link is on the way. Check your inbox.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sign-up is temporarily unavailable.";
      setErrorMessage(message);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">Create your account</p>
        <h1 className="type-display-small text-on-surface">Join Atlas</h1>
        <p className="type-body-large text-outline">
          Enter your email and we&apos;ll send you a link to get started. Free to join.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          autoComplete="email"
          required
          icon={<Mail className="h-4 w-4" />}
        />

        <Button type="submit" disabled={isPending || !email.trim()}>
          {isPending ? "Creating account..." : "Create account"}
        </Button>
      </form>

      {statusMessage ? (
        <p className="type-body-medium bg-surface-container-lowest text-on-surface rounded-2xl px-4 py-3">
          {statusMessage}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="type-body-medium rounded-2xl bg-red-50 px-4 py-3 text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <p className="type-body-medium text-outline">
        Already have an account?{" "}
        <Link
          to="/sign-in"
          search={redirectTo ? { redirect: redirectTo } : undefined}
          className="text-accent type-label-medium hover:underline"
        >
          Sign in &rarr;
        </Link>
      </p>
    </div>
  );
}
