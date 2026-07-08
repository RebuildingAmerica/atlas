import type {
  ApiEdgeConfig,
  CloudflareRateLimitRule,
} from "./api-edge-models.js";

const EDGE_RATE_LIMIT_RULE_DESCRIPTIONS = new Set([
  "Atlas anonymous API reads",
  "Atlas anonymous API writes",
  "Atlas anonymous sustained API traffic",
  "Atlas credentialed API pre-auth traffic",
  "Atlas credentialed sustained API pre-auth traffic",
  "Atlas API origin abuse backstop",
]);
const EDGE_TRANSFORM_RULE_DESCRIPTIONS = new Set([
  "Atlas API origin identity headers",
]);

export { EDGE_RATE_LIMIT_RULE_DESCRIPTIONS, EDGE_TRANSFORM_RULE_DESCRIPTIONS };

export function buildRateLimitRules(domain: string): CloudflareRateLimitRule[] {
  const protectedPaths =
    '(starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/mcp") or http.request.uri.path eq "/openapi.json" or http.request.uri.path eq "/docs")';
  const noCredentials =
    '(len(http.request.headers["authorization"]) eq 0 and len(http.request.headers["x-api-key"]) eq 0)';
  const credentialsPresent =
    '(len(http.request.headers["authorization"]) gt 0 or len(http.request.headers["x-api-key"]) gt 0)';
  const methodIsRead =
    '(http.request.method eq "GET" or http.request.method eq "HEAD")';
  const methodIsWrite =
    '(http.request.method ne "GET" and http.request.method ne "HEAD" and http.request.method ne "OPTIONS")';
  const methodIsCounted = '(http.request.method ne "OPTIONS")';
  const baseExpression = `http.host eq "${domain}" and ${protectedPaths}`;

  return [
    rateLimitRule({
      description: "Atlas anonymous API reads",
      expression: `(${baseExpression} and ${methodIsRead} and ${noCredentials})`,
      mitigationTimeout: 60,
      period: 60,
      requestsPerPeriod: 30,
    }),
    rateLimitRule({
      description: "Atlas anonymous API writes",
      expression: `(${baseExpression} and ${methodIsWrite} and ${noCredentials})`,
      mitigationTimeout: 60,
      period: 60,
      requestsPerPeriod: 10,
    }),
    rateLimitRule({
      description: "Atlas anonymous sustained API traffic",
      expression: `(${baseExpression} and ${methodIsCounted} and ${noCredentials})`,
      mitigationTimeout: 300,
      period: 3600,
      requestsPerPeriod: 120,
    }),
    rateLimitRule({
      description: "Atlas credentialed API pre-auth traffic",
      expression: `(${baseExpression} and ${methodIsCounted} and ${credentialsPresent})`,
      mitigationTimeout: 60,
      period: 60,
      requestsPerPeriod: 60,
    }),
    rateLimitRule({
      description: "Atlas credentialed sustained API pre-auth traffic",
      expression: `(${baseExpression} and ${methodIsCounted} and ${credentialsPresent})`,
      mitigationTimeout: 300,
      period: 3600,
      requestsPerPeriod: 600,
    }),
    rateLimitRule({
      description: "Atlas API origin abuse backstop",
      expression: `(${baseExpression} and ${methodIsCounted})`,
      mitigationTimeout: 60,
      period: 60,
      requestsPerPeriod: 300,
    }),
  ];
}

export function buildTransformRules(
  config: ApiEdgeConfig,
): CloudflareRateLimitRule[] {
  return [
    {
      action: "rewrite",
      action_parameters: {
        headers: {
          "X-Atlas-Client-IP": {
            expression: "to_string(ip.src)",
            operation: "set",
          },
          "X-Atlas-Proxy-Secret": {
            operation: "set",
            value: config.edgeOriginSecret,
          },
        },
      },
      description: "Atlas API origin identity headers",
      enabled: true,
      expression: `http.host eq "${config.domain}"`,
      ref: "atlas-api-origin-identity-headers",
    },
  ];
}

export function comparableRules(
  rules: CloudflareRateLimitRule[],
): CloudflareRateLimitRule[] {
  return rules.map((rule) => ({
    action: rule.action,
    action_parameters: rule.action_parameters,
    description: rule.description,
    enabled: rule.enabled,
    expression: rule.expression,
    ratelimit: rule.ratelimit,
    ref: rule.ref,
  }));
}

export function stripCloudflareReadOnlyFields(
  rule: CloudflareRateLimitRule,
): CloudflareRateLimitRule {
  const {
    id: _id,
    last_updated: _lastUpdated,
    version: _version,
    ...updatable
  } = rule;
  return updatable;
}

function rateLimitRule(input: {
  description: string;
  expression: string;
  mitigationTimeout: number;
  period: number;
  requestsPerPeriod: number;
}): CloudflareRateLimitRule {
  return {
    action: "block",
    action_parameters: {
      response: {
        content: JSON.stringify({ detail: "Too many requests." }),
        content_type: "application/json",
        status_code: 429,
      },
    },
    description: input.description,
    enabled: true,
    expression: input.expression,
    ratelimit: {
      characteristics: ["cf.colo.id", "ip.src"],
      mitigation_timeout: input.mitigationTimeout,
      period: input.period,
      requests_per_period: input.requestsPerPeriod,
      requests_to_origin: true,
    },
    ref: input.description.toLowerCase().replaceAll(" ", "-"),
  };
}
