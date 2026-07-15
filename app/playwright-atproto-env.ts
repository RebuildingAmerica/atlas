interface AtprotoHarnessEnv {
  ATLAS_ATPROTO_OAUTH_E2E_HARNESS?: string;
  ATLAS_ATPROTO_PDS_E2E_HARNESS?: string;
}

export function resolveAtprotoOAuthHarnessMode(env: AtprotoHarnessEnv): "0" | "1" {
  const explicit = env.ATLAS_ATPROTO_OAUTH_E2E_HARNESS?.trim();
  if (explicit === "0" || explicit === "1") {
    return explicit;
  }
  if (explicit) {
    throw new Error("ATLAS_ATPROTO_OAUTH_E2E_HARNESS must be 0 or 1.");
  }
  return "1";
}

export function resolveAtprotoPdsHarnessMode(env: AtprotoHarnessEnv): "0" | "1" {
  const explicit = env.ATLAS_ATPROTO_PDS_E2E_HARNESS?.trim();
  if (explicit === "0" || explicit === "1") {
    return explicit;
  }
  if (explicit) {
    throw new Error("ATLAS_ATPROTO_PDS_E2E_HARNESS must be 0 or 1.");
  }
  return "1";
}
