/**
 * Shared flash/error state setters used by organization-page mutation hooks.
 */
export interface OrganizationPageMutationFeedback {
  setErrorMessage: (value: string | null) => void;
  setFlashMessage: (value: string | null) => void;
}

/**
 * Runs one async organization-page mutation with consistent flash/error
 * handling and post-mutation refresh behavior.
 *
 * @param params - The mutation helpers and UI copy to apply.
 * @param params.action - The async mutation to run.
 * @param params.fallbackMessage - The fallback message for non-Error failures.
 * @param params.feedback - The flash/error setter pair.
 * @param params.refreshWorkspaceData - The shared query refresh callback.
 * @param params.successMessage - The flash copy to show after success.
 */
export async function runOrganizationPageMutation<T>(params: {
  action: () => Promise<T>;
  fallbackMessage: string;
  feedback: OrganizationPageMutationFeedback;
  refreshWorkspaceData: () => Promise<void>;
  successMessage: string;
}): Promise<T | null> {
  params.feedback.setErrorMessage(null);
  params.feedback.setFlashMessage(null);

  try {
    const mutationResult = await params.action();

    await params.refreshWorkspaceData();
    params.feedback.setFlashMessage(params.successMessage);

    return mutationResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : params.fallbackMessage;

    params.feedback.setErrorMessage(message);

    return null;
  }
}
