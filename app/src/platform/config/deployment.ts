import { parseEnvBoolean } from "./env-boolean";

/**
 * Whether this instance has accounts.
 *
 * The API asks the same question of the same variable
 * (`Settings.multi_user`), so the two halves cannot reach different
 * conclusions about the same deployment — which is exactly what they did while
 * the app read `ATLAS_DEPLOY_MODE` and the API read `ENVIRONMENT`.
 *
 * @param env - Environment to read.
 * @returns True when sign-in, organizations, and billing exist.
 */
export function hasAccounts(env: NodeJS.ProcessEnv): boolean {
  return parseEnvBoolean(env.ATLAS_MULTI_USER, true, "ATLAS_MULTI_USER");
}
