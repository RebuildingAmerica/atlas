/**
 * The v1 scope surface for direct API keys.
 *
 * Browser sessions still carry full operator access; these scopes are only
 * used when the backend authorizes requests authenticated by API key.
 */
export const API_KEY_SCOPES = ["discovery:read", "discovery:write", "entities:write"] as const;

/**
 * Union type for every supported API-key scope string.
 */
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Better Auth stores API-key permissions as a resource-to-actions map.
 *
 * Example: `{ discovery: ["read", "write"] }`
 */
export type ApiKeyPermissions = Record<string, string[]>;

/**
 * Splits a scope string like `discovery:read` into its resource/action pair.
 */
export function scopeToPermission(scope: ApiKeyScope): [string, string] {
  const [resource, action] = scope.split(":", 2) as [string, string];
  return [resource, action];
}

/**
 * Converts the Atlas scope list into Better Auth's permissions payload shape.
 */
export function scopesToPermissions(scopes: ApiKeyScope[]): ApiKeyPermissions {
  return scopes.reduce<ApiKeyPermissions>((permissions, scope) => {
    const [resource, action] = scopeToPermission(scope);
    permissions[resource] = Array.from(new Set([...(permissions[resource] ?? []), action]));
    return permissions;
  }, {});
}

/**
 * Converts Better Auth permissions back into the Atlas scope list used by the
 * UI and API.
 */
export function permissionsToScopes(
  permissions: ApiKeyPermissions | null | undefined,
): ApiKeyScope[] {
  if (!permissions) {
    return [];
  }

  return API_KEY_SCOPES.filter((scope) => {
    const [resource, action] = scopeToPermission(scope);
    return permissions[resource]?.includes(action) ?? false;
  });
}
