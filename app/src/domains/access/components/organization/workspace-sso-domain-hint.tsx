/**
 * Props for the workspace-domain suggestion hint shown in SSO setup forms.
 */
interface WorkspaceSSODomainHintProps {
  suggestion: string;
}

/**
 * Explains where Atlas derived the visible workspace-domain suggestion from
 * and reminds operators that they can edit it before saving.
 */
export function WorkspaceSSODomainHint({ suggestion }: WorkspaceSSODomainHintProps) {
  return (
    <p className="type-body-small text-ink-muted">
      Suggested from your signed-in email:{" "}
      <span className="text-ink-strong font-medium">{suggestion}</span>. Update this if the
      workspace should verify a different domain.
    </p>
  );
}
