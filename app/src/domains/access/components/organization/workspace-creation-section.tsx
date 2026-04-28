import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { checkWorkspaceSlugAvailability } from "@/domains/access/organizations.functions";

/**
 * Workspace shape choices Atlas exposes during workspace creation.  Stored as
 * a single source of truth so the radio cards, plan-required note, and the
 * select-event handlers all stay in sync.
 */
interface WorkspaceTypeOption {
  description: string;
  planNote: string | null;
  title: string;
  value: "individual" | "team";
}

const WORKSPACE_TYPE_OPTIONS: readonly WorkspaceTypeOption[] = [
  {
    description: "Best for solo work — no team-management controls.",
    planNote: null,
    title: "Individual workspace",
    value: "individual",
  },
  {
    description: "Built for shared discovery, role-based access, and team invitations.",
    planNote: "Atlas Team plan required to invite members and enable SSO. You can upgrade later.",
    title: "Team workspace",
    value: "team",
  },
] as const;

const SLUG_DEBOUNCE_MS = 400;

type SlugAvailability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken" };

/**
 * Props for the first-workspace creation section.
 */
interface WorkspaceCreationSectionProps {
  isPending: boolean;
  workspaceDelegatedEmail: string;
  workspaceDomain: string;
  workspaceName: string;
  workspaceSlug: string;
  workspaceType: "individual" | "team";
  onDelegatedEmailChange: (value: string) => void;
  onDomainChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onWorkspaceTypeChange: (value: string) => void;
}

/**
 * Workspace creation form shown when the signed-in operator has not created or
 * joined a workspace yet.
 *
 * The workspace-shape selector renders as two clickable cards rather than a
 * native `<select>` so the operator can scan the trade-offs (and the
 * "Atlas Team plan required" note) without opening a dropdown.  The slug
 * field debounces a server-side availability check against Better Auth so a
 * collision surfaces before submission rather than after.  Team workspaces
 * additionally collect an email domain — saved on the workspace metadata for
 * later SSO pre-fill — and an optional "I'm setting this up for someone else"
 * disclosure that, when filled, immediately sends an admin invite to the
 * eventual owner.
 *
 * @param props - Form state and event handlers.
 */
export function WorkspaceCreationSection({
  isPending,
  onDelegatedEmailChange,
  onDomainChange,
  onNameChange,
  onSlugChange,
  onSubmit,
  onWorkspaceTypeChange,
  workspaceDelegatedEmail,
  workspaceDomain,
  workspaceName,
  workspaceSlug,
  workspaceType,
}: WorkspaceCreationSectionProps) {
  const [slugAvailability, setSlugAvailability] = useState<SlugAvailability>({ state: "idle" });
  const [isHandoffOpen, setIsHandoffOpen] = useState(workspaceDelegatedEmail.trim().length > 0);

  useEffect(() => {
    const trimmed = workspaceSlug.trim();
    if (trimmed.length < 3) {
      setSlugAvailability({ state: "idle" });
      return;
    }
    setSlugAvailability({ state: "checking" });
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await checkWorkspaceSlugAvailability({ data: { slug: trimmed } });
          if (cancelled) return;
          setSlugAvailability({ state: result.available ? "available" : "taken" });
        } catch {
          if (cancelled) return;
          setSlugAvailability({ state: "idle" });
        }
      })();
    }, SLUG_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [workspaceSlug]);

  const isTeam = workspaceType === "team";
  const submitDisabled =
    isPending ||
    !workspaceName.trim() ||
    !workspaceSlug.trim() ||
    slugAvailability.state === "taken";

  return (
    <section className="border-outline bg-surface rounded-[1.5rem] border p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div role="radiogroup" aria-label="Workspace shape" className="space-y-3">
          {WORKSPACE_TYPE_OPTIONS.map((option) => {
            const selected = workspaceType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  onWorkspaceTypeChange(option.value);
                }}
                className={`w-full cursor-pointer rounded-[1.25rem] border p-4 text-left transition-[color,background-color,border-color] focus:ring-2 focus:ring-offset-2 focus:outline-none ${
                  selected
                    ? "border-primary bg-primary/5 focus:ring-primary"
                    : "border-outline-variant hover:border-outline focus:ring-border bg-white/70"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-primary bg-primary" : "border-outline bg-white"
                    }`}
                  >
                    {selected ? <span className="block h-1.5 w-1.5 rounded-full bg-white" /> : null}
                  </span>
                  <div className="flex-1 space-y-1">
                    <p className="type-title-small text-on-surface">{option.title}</p>
                    <p className="type-body-medium text-outline">{option.description}</p>
                    {option.planNote ? (
                      <p className="type-body-small text-outline mt-2">{option.planNote}</p>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <Input
            label="Workspace name"
            value={workspaceName}
            onChange={onNameChange}
            placeholder="Your team or organization"
          />
          <div className="space-y-1">
            <Input
              label="Workspace slug"
              value={workspaceSlug}
              onChange={onSlugChange}
              placeholder="your-team"
            />
            {workspaceSlug.trim().length >= 3 ? (
              <p
                className={`type-body-small flex items-center gap-1.5 ${
                  slugAvailability.state === "taken"
                    ? "text-red-700"
                    : slugAvailability.state === "available"
                      ? "text-emerald-700"
                      : "text-outline"
                }`}
                aria-live="polite"
              >
                {slugAvailability.state === "checking" ? "Checking availability..." : null}
                {slugAvailability.state === "available" ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Slug is available.
                  </>
                ) : null}
                {slugAvailability.state === "taken" ? (
                  <>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    Slug is already taken — try another.
                  </>
                ) : null}
              </p>
            ) : null}
          </div>

          {isTeam ? (
            <div className="space-y-1">
              <Input
                label="Email domain (optional)"
                value={workspaceDomain}
                onChange={onDomainChange}
                placeholder="example.com"
              />
              <p className="type-body-small text-outline">
                We'll prefill this when you set up SSO. Use the domain your members sign in with.
              </p>
            </div>
          ) : null}

          {isTeam ? (
            <details
              open={isHandoffOpen}
              onToggle={(event) => {
                setIsHandoffOpen((event.currentTarget as HTMLDetailsElement).open);
              }}
              className="border-outline-variant rounded-[1rem] border bg-white/70 p-4"
            >
              <summary className="type-label-medium text-on-surface cursor-pointer">
                Setting this up for someone else?
              </summary>
              <div className="mt-3 space-y-3">
                <p className="type-body-small text-outline">
                  Atlas will create the workspace under your account and email an admin invitation
                  to the address below. Once they accept, you can transfer ownership in the members
                  panel.
                </p>
                <Input
                  label="Future admin email"
                  type="email"
                  value={workspaceDelegatedEmail}
                  onChange={onDelegatedEmailChange}
                  placeholder="admin@example.com"
                  autoComplete="email"
                />
              </div>
            </details>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitDisabled}>
              {isPending ? "Creating..." : "Create workspace"}
            </Button>
            <p className="type-body-medium text-outline">
              The first workspace becomes your active context automatically.
            </p>
          </div>
        </form>
      </div>
    </section>
  );
}
