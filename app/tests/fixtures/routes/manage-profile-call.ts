import { expect } from "vitest";

/**
 * Body shape passed to `useManageProfile().mutateAsync` from the manage-profile
 * route.  The route bundles slug + a partial profile-management payload and
 * tests assert the trimmed/normalised values it emits.
 */
export interface ManageProfileMutateCall {
  slug: string;
  body: {
    custom_bio?: string;
    photo_url?: string;
    preferred_contact_channel?: string;
    suppressed_source_ids: string[];
    clear_photo: boolean;
    clear_custom_bio: boolean;
  };
}

/**
 * Reads the first argument of the most recent mock call as a
 * `ManageProfileMutateCall`. Throws via `expect` if no call was recorded.
 *
 * @param spy - The vi.fn used as the manage-profile mutateAsync mock.
 */
export function readManageProfileCall(spy: {
  mock: { calls: unknown[][] };
}): ManageProfileMutateCall {
  const call = spy.mock.calls[0];
  expect(call).toBeDefined();
  if (!call) {
    throw new Error("Expected the manage-profile mutation to have been invoked.");
  }
  return call[0] as ManageProfileMutateCall;
}
