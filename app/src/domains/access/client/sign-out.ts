import { getAuthClient } from "./auth-client";

export interface SignOutWithRedirectOptions {
  redirectTo: string;
  onError?: () => void;
}

export async function signOutWithRedirect({
  redirectTo,
  onError,
}: SignOutWithRedirectOptions): Promise<void> {
  let redirected = false;
  const redirectOnce = () => {
    if (redirected) {
      return;
    }

    redirected = true;
    window.location.assign(redirectTo);
  };

  try {
    await getAuthClient().signOut({
      fetchOptions: {
        onSuccess: redirectOnce,
      },
    });
    redirectOnce();
  } catch {
    if (!redirected) {
      onError?.();
    }
  }
}
