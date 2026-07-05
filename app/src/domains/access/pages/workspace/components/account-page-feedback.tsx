import { AccountSettingsNotice } from "./account-settings-section";

interface AccountPageFeedbackProps {
  errorMessage: string | null;
  flashMessage: string | null;
}

export function AccountPageFeedback({ errorMessage, flashMessage }: AccountPageFeedbackProps) {
  if (!flashMessage && !errorMessage) {
    return null;
  }

  return (
    <div className="space-y-3">
      {flashMessage ? (
        <AccountSettingsNotice tone="success">{flashMessage}</AccountSettingsNotice>
      ) : null}

      {errorMessage ? (
        <AccountSettingsNotice tone="error">{errorMessage}</AccountSettingsNotice>
      ) : null}
    </div>
  );
}
