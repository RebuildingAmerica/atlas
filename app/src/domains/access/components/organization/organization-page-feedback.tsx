/**
 * Props for the shared organization page feedback banners.
 */
interface OrganizationPageFeedbackProps {
  errorMessage: string | null;
  flashMessage: string | null;
}

/**
 * Shared feedback banners for organization-management pages.
 */
export function OrganizationPageFeedback({
  errorMessage,
  flashMessage,
}: OrganizationPageFeedbackProps) {
  return (
    <>
      {flashMessage ? (
        <p className="type-body-medium bg-surface-container-lowest text-ink-strong rounded-2xl px-4 py-3">
          {flashMessage}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="type-body-medium border-border-strong bg-surface text-ink-strong rounded-2xl border px-4 py-3">
          {errorMessage}
        </p>
      ) : null}
    </>
  );
}
