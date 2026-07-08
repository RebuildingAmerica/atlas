export interface ApiEdgeConfig {
  target: "prod" | "staging";
  domain: string;
  service: string;
  region: string;
  project: string;
  edgeOriginSecret: string;
}

export interface CloudflareError {
  code: number;
  message: string;
}

export interface CloudflareEnvelope<T> {
  success: boolean;
  result?: T;
  errors?: CloudflareError[];
}

export interface CloudflareApiResult<T> {
  ok: boolean;
  status: number;
  value: T | null;
  error: string | null;
}

export interface CloudflareResponseParameters {
  content: string;
  content_type: string;
  status_code: number;
}

export interface CloudflareHeaderTransformParameters {
  expression?: string;
  operation: string;
  value?: string;
}

export interface CloudflareActionParameters {
  headers?: Record<string, CloudflareHeaderTransformParameters>;
  response?: CloudflareResponseParameters;
}

export interface CloudflareRateLimitParameters {
  characteristics: string[];
  mitigation_timeout: number;
  period: number;
  requests_per_period: number;
  requests_to_origin: boolean;
}

export interface CloudflareRateLimitRule {
  [key: string]: unknown;
  action: string;
  action_parameters?: CloudflareActionParameters;
  description: string;
  enabled: boolean;
  expression: string;
  ratelimit?: CloudflareRateLimitParameters;
  ref?: string;
}

export interface CloudflareRuleset {
  description?: string;
  id: string;
  kind: string;
  name: string;
  phase: string;
  rules?: CloudflareRateLimitRule[];
}

export interface RulesetLookup {
  ok: boolean;
  ruleset: CloudflareRuleset | null;
  error: string | null;
}

export interface EdgeRuleResult {
  ok: boolean;
  created: boolean;
  changed: boolean;
  error: string | null;
}

export interface HealthProbe {
  healthy: boolean;
  statusCode: number | null;
  viaCloudflare: boolean;
  output: string;
}
