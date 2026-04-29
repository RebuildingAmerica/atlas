/**
 * The shape of the JSON body the internal API-key introspection endpoint
 * returns when a key is recognized. Tests use this to type-narrow parsed
 * Response bodies without re-stating the literal in each call site.
 */
export interface ApiKeyIntrospectionResult {
  name: string;
  organizationId?: string;
  userEmail: string;
}
