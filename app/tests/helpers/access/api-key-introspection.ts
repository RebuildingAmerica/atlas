/**
 * The shape of the JSON body the internal API-key introspection endpoint
 * returns when a key is recognized. Tests use this to type-narrow parsed
 * Response bodies without re-stating the literal in each call site.
 */
export interface InvalidApiKeyIntrospectionResult {
  valid: false;
}

export interface ApiKeyIntrospectionResult {
  activeProducts: string[];
  keyId: string;
  name: string;
  organizationId?: string;
  permissions: Record<string, string[]>;
  scopes: string[];
  userEmail: string;
  userId: string;
  valid: true;
}

export type ApiKeyIntrospectionResponse =
  ApiKeyIntrospectionResult | InvalidApiKeyIntrospectionResult;
