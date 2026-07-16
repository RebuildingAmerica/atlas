import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Info } from "lucide-react";
import { Mail } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";

export interface SignInEmailFormProps {
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
        label="Email or username"
        type="text"
        value={email}
        onChange={onEmailChange}
        placeholder="you@example.com or @gwashington.org"
        autoComplete="username webauthn"
        required
        icon={<Mail className="h-4 w-4" />}
        labelAdornment={<UsernameHelpPopover />}
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

        <Button
          type="submit"
          variant="secondary"
          className="min-h-10 px-4"
          disabled={isPending || !email.trim()}
        >
          {isPending ? "Sending..." : isEmailFallbackVisible ? "Continue with email" : "Continue"}
        </Button>

        <div className="pt-1">
          {isEmailFallbackVisible ? null : (
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

function UsernameHelpPopover() {
  return (
    <Popover className="relative">
      <PopoverButton
        type="button"
        aria-label="How usernames work"
        className="text-ink-soft hover:text-on-surface focus-visible:ring-accent inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2"
      >
        <Info className="h-4 w-4" aria-hidden />
      </PopoverButton>
      <PopoverPanel className="bg-surface-container-high text-on-surface shadow-elevation-3 absolute left-0 z-20 mt-2 w-80 max-w-[calc(100vw-3rem)] rounded-2xl p-4">
        <p className="type-body-small">
          If you have an ATProto handle (like on Bluesky) connected to your account, you can use it
          to sign in.
        </p>
        <a
          href="/docs/product/atproto-native-identity-transition"
          className="type-label-medium text-accent mt-3 inline-flex hover:underline"
        >
          Learn more
        </a>
      </PopoverPanel>
    </Popover>
  );
}
