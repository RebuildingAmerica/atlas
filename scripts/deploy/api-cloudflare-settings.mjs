/** Preserve the existing API's identities and database without exposing secrets. */
export function apiSettingsFromService(service, webRuntime) {
  const containers = service?.spec?.template?.spec?.containers;
  if (!Array.isArray(containers) || containers.length !== 1)
    throw Error("Exactly one original API container is required.");
  const settings = {};
  for (const entry of containers[0].env ?? []) {
    if (!entry.name || entry.valueFrom || Object.hasOwn(settings, entry.name))
      throw Error("API settings require unique, resolved environment values.");
    if (entry.value !== undefined && typeof entry.value !== "string")
      throw Error("API settings require text environment values.");
    // Cloud Run omits the value property for an explicitly empty variable.
    settings[entry.name] = entry.value ?? "";
  }
  if (
    settings.ENVIRONMENT !== "production" ||
    settings.DATABASE_BACKEND !== "postgres" ||
    settings.ATLAS_MULTI_USER !== "true" ||
    settings.ATLAS_MANAGED !== "true"
  )
    throw Error(
      "The original managed production API configuration is required.",
    );
  if (
    !settings.DATABASE_URL ||
    settings.DATABASE_URL !== webRuntime.DATABASE_URL ||
    !settings.ATLAS_AUTH_INTERNAL_SECRET ||
    settings.ATLAS_AUTH_INTERNAL_SECRET !==
      webRuntime.ATLAS_AUTH_INTERNAL_SECRET
  )
    throw Error(
      "API database and authentication must match the existing web service.",
    );
  const canonical =
    webRuntime.ATLAS_WEB_CANONICAL_URL ?? webRuntime.ATLAS_PUBLIC_URL;
  if (settings.ATLAS_PUBLIC_URL !== canonical)
    throw Error("The existing canonical API identity must be preserved.");
  for (const key of [
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
    "ATLAS_AUTH_MEMBERSHIP_URL",
    "ATLAS_AUTH_JWT_AUDIENCES",
    "ATLAS_EDGE_ORIGIN_SECRET",
    "CORS_ORIGINS",
  ])
    if (!settings[key]) throw Error(`Original API setting ${key} is required.`);
  return settings;
}
