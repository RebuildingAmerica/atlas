const SCOPE_LABELS: Record<string, { title: string; description: string }> = {
  openid: { title: "Basic identity", description: "Your account identifier" },
  profile: { title: "Profile", description: "Your name and avatar" },
  email: { title: "Email address", description: "Your verified email" },
  offline_access: { title: "Persistent access", description: "Maintain access between sessions" },
  "discovery:read": { title: "View discoveries", description: "Read discovery runs and results" },
  "discovery:write": { title: "Manage discoveries", description: "Create and run discoveries" },
  "entities:write": { title: "Edit entities", description: "Create and update catalog entries" },
};

interface OAuthScopeListProps {
  scopes: string[];
}

/**
 * Renders the list of requested OAuth scopes with human-readable titles
 * and descriptions when Atlas knows the scope name; falls back to the
 * raw scope string otherwise so unfamiliar scopes still render.
 */
export function OAuthScopeList({ scopes }: OAuthScopeListProps) {
  if (scopes.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="type-label-medium text-ink-muted">This will allow the app to:</p>
      <ul className="space-y-2">
        {scopes.map((s) => {
          const label = SCOPE_LABELS[s];
          return (
            <li
              key={s}
              className="border-border bg-surface-container-lowest rounded-[1.4rem] border px-4 py-3"
            >
              <p className="type-title-small text-ink-strong">{label?.title ?? s}</p>
              {label?.description ? (
                <p className="type-body-small text-ink-soft mt-0.5">{label.description}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
