import type { FetchResponder, StubbedResponse } from "../stub-fetch";

/** What the Atlas API answers to the two checkout probes. */
export interface CheckoutApiState {
  catalog: StubbedResponse;
  serviceStatus: StubbedResponse;
}

/** An API with a serving catalog and checkout open, with any reply changed. */
export function checkoutApi(overrides: Partial<CheckoutApiState> = {}): FetchResponder {
  const state: CheckoutApiState = {
    catalog: { body: { items: [{ id: "e1" }] } },
    serviceStatus: { body: { checkout_open: true } },
    ...overrides,
  };
  return (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return url.endsWith("/service-status") ? state.serviceStatus : state.catalog;
  };
}
