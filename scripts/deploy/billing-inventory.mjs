const CHECK_NAMES = [
  "Runtime key",
  "Charge-enabled account",
  "Stripe Tax",
  "Customer portal",
  "Catalog IDs",
  "Webhook endpoint metadata",
];

export function runtimeInventoryPasses(payload, expectedRevision) {
  return (
    /^[a-f0-9]{40}$/i.test(expectedRevision) &&
    typeof payload?.revision === "string" &&
    payload.revision.toLowerCase() === expectedRevision.toLowerCase() &&
    Array.isArray(payload.checks) &&
    payload.checks.length === CHECK_NAMES.length &&
    CHECK_NAMES.every(
      (name) =>
        payload.checks.filter(
          (check) => check?.name === name && check.status === "pass",
        ).length === 1,
    )
  );
}
