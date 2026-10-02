/**
 * Plans the Cloudflare Access application that gates the platform admin host.
 *
 * Pure: it compares what Access has now with what Atlas wants and returns
 * readable findings plus the changes that would close the gap. The phase runs
 * the plan through the `cf` CLI; doctor mode only prints the findings.
 *
 * Shapes follow the org's Access reconciler (repository-tooling
 * `plan-access.mjs` / `apply-resources.mjs`), with two additions it lacks: the
 * allow policy also requires the organization's email domain, and the
 * application must not appear in the App Launcher.
 */

export interface AccessGateConfig {
  /** Display name of the Access application. */
  appName: string;
  /** Host the application protects, such as `atlas-admin.rebuildingus.org`. */
  hostname: string;
  /** People allowed in, by exact email. */
  operatorEmails: string[];
  /** Domain every allowed address must end in, such as `rebuildingus.org`. */
  emailDomain: string;
  /** How long an Access session lasts before Google sign-in is asked again. */
  sessionDuration: string;
}

export type AccessRule = Record<string, unknown>;

export interface AccessPolicy {
  id: string;
  name?: string;
  decision?: string;
  include?: AccessRule[];
  require?: AccessRule[];
}

export interface AttachedPolicy {
  id: string;
  precedence?: number;
  decision?: string;
  include?: AccessRule[];
  require?: AccessRule[];
}

export interface AccessApp {
  id: string;
  aud?: string;
  name?: string;
  domain?: string;
  destinations?: { type?: string; uri: string }[];
  self_hosted_domains?: string[];
  session_duration?: string;
  allowed_idps?: string[];
  auto_redirect_to_identity?: boolean;
  app_launcher_visible?: boolean;
  enable_binding_cookie?: boolean;
  http_only_cookie_attribute?: boolean;
  same_site_cookie_attribute?: string;
  policies?: AttachedPolicy[];
}

export interface AccessProvider {
  id: string;
  name: string;
  type: string;
}

export interface ObservedAccess {
  /** The Zero Trust team domain, or null when Zero Trust is off. */
  teamDomain: string | null;
  providers: AccessProvider[];
  apps: AccessApp[];
  policies: AccessPolicy[];
}

export interface GateFinding {
  status: "ok" | "missing" | "mismatch";
  label: string;
  detail: string;
}

export interface PolicyBody {
  name: string;
  decision: "allow";
  include: AccessRule[];
  require: AccessRule[];
}

export interface AppBody {
  name: string;
  type: "self_hosted";
  domain: string;
  destinations: { type: "public"; uri: string }[];
  session_duration: string;
  allowed_idps: string[];
  auto_redirect_to_identity: true;
  app_launcher_visible: false;
  /** Ties the session cookie to the browser that signed in, so a copied cookie is useless elsewhere. */
  enable_binding_cookie: true;
  http_only_cookie_attribute: true;
  same_site_cookie_attribute: "lax";
  policies: { id: string; precedence: number }[];
}

export type GateAction =
  | { type: "create-policy"; body: PolicyBody }
  | { type: "update-policy"; id: string; body: PolicyBody }
  | { type: "create-app"; providerId: string }
  | { type: "update-app"; found: AccessApp; providerId: string };

export interface GatePlan {
  blocked: string | null;
  findings: GateFinding[];
  actions: GateAction[];
}

const GOOGLE_WORKSPACE = "google-apps";

function same(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

function ruleEmail(rule: AccessRule): unknown {
  return (rule.email as { email?: unknown } | undefined)?.email;
}

function ruleDomain(rule: AccessRule): unknown {
  return (rule.email_domain as { domain?: unknown } | undefined)?.domain;
}

/** The reusable policy that admits the operators and nobody else. */
export function allowPolicyBody(config: AccessGateConfig): PolicyBody {
  return {
    decision: "allow",
    include: config.operatorEmails.map((email) => ({ email: { email } })),
    name: `${config.appName} allow`,
    require: [{ email_domain: { domain: config.emailDomain } }],
  };
}

function admitsOperators(
  policy: AccessPolicy | AttachedPolicy,
  config: AccessGateConfig,
): boolean {
  const include = policy.include ?? [];
  return config.operatorEmails.every((email) =>
    include.some((rule) => same(ruleEmail(rule), email)),
  );
}

function requiresDomain(
  policy: AccessPolicy | AttachedPolicy,
  config: AccessGateConfig,
): boolean {
  return (policy.require ?? []).some((rule) =>
    same(ruleDomain(rule), config.emailDomain),
  );
}

function letsEveryoneIn(
  policy: AccessPolicy | AttachedPolicy | undefined,
): boolean {
  return (
    policy?.decision === "allow" &&
    (policy.include ?? []).some((rule) => "everyone" in rule)
  );
}

interface AppBodyContext {
  existingPolicies: AttachedPolicy[];
  reusablePolicies: AccessPolicy[];
}

function resolvePolicy(
  attached: AttachedPolicy,
  reusable: AccessPolicy[],
): AccessPolicy | AttachedPolicy | undefined {
  return attached.include
    ? attached
    : reusable.find((policy) => policy.id === attached.id);
}

/**
 * The application as Atlas wants it. Policies already attached stay, after
 * the allow policy, except any that lets everyone in: that is the mismatch
 * being fixed, and keeping it would leave the admin host open.
 */
export function appBody(
  config: AccessGateConfig,
  providerId: string,
  policyId: string,
  context: AppBodyContext = { existingPolicies: [], reusablePolicies: [] },
): AppBody {
  const kept = context.existingPolicies.filter(
    (policy) =>
      policy.id !== policyId &&
      !letsEveryoneIn(resolvePolicy(policy, context.reusablePolicies)),
  );
  return {
    allowed_idps: [providerId],
    app_launcher_visible: false,
    auto_redirect_to_identity: true,
    destinations: [{ type: "public", uri: config.hostname }],
    domain: config.hostname,
    enable_binding_cookie: true,
    http_only_cookie_attribute: true,
    name: config.appName,
    same_site_cookie_attribute: "lax",
    policies: [
      { id: policyId, precedence: 1 },
      ...kept.map((policy, index) => ({
        id: policy.id,
        precedence: index + 2,
      })),
    ],
    session_duration: config.sessionDuration,
    type: "self_hosted",
  };
}

function appHosts(app: AccessApp): Set<string> {
  return new Set([
    ...(app.destinations ?? [])
      .filter(
        (destination) => !destination.type || destination.type === "public",
      )
      .map((destination) => destination.uri),
    ...(app.self_hosted_domains ?? []),
    ...(app.domain ? [app.domain] : []),
  ]);
}

function findApp(
  apps: AccessApp[],
  config: AccessGateConfig,
): AccessApp | undefined {
  return (
    apps.find((app) => app.name === config.appName) ??
    apps.find((app) => appHosts(app).has(config.hostname))
  );
}

function policyReasons(
  app: AccessApp,
  config: AccessGateConfig,
  reusable: AccessPolicy[],
): string[] {
  const allows = (app.policies ?? [])
    .map((policy) => resolvePolicy(policy, reusable))
    .filter((policy) => policy?.decision === "allow");
  const reasons: string[] = [];
  if (allows.some((policy) => letsEveryoneIn(policy))) {
    reasons.push("has an allow policy that lets everyone in");
  }
  if (!allows.some((policy) => policy && admitsOperators(policy, config))) {
    reasons.push(`has no allow policy for ${config.operatorEmails.join(", ")}`);
  }
  return reasons;
}

function appReasons(
  app: AccessApp,
  config: AccessGateConfig,
  provider: AccessProvider,
  reusable: AccessPolicy[],
): string[] {
  const reasons: string[] = [];
  if (!appHosts(app).has(config.hostname))
    reasons.push(`does not protect ${config.hostname}`);
  if (app.session_duration && app.session_duration !== config.sessionDuration) {
    reasons.push(
      `signs people in for ${app.session_duration}, not ${config.sessionDuration}`,
    );
  }
  if (Array.isArray(app.allowed_idps) && app.allowed_idps.length === 0) {
    reasons.push(`accepts every identity provider, not only ${provider.name}`);
  } else if (!app.allowed_idps?.includes(provider.id)) {
    reasons.push(`does not offer ${provider.name}`);
  }
  if (app.app_launcher_visible === true)
    reasons.push("shows in the App Launcher");
  if (app.auto_redirect_to_identity === false) {
    reasons.push(`does not send people straight to ${provider.name}`);
  }
  if (app.enable_binding_cookie !== true) {
    reasons.push("does not bind its session cookie to the browser");
  }
  if (app.http_only_cookie_attribute !== true) {
    reasons.push("lets page scripts read its session cookie");
  }
  if (app.same_site_cookie_attribute !== "lax") {
    reasons.push("sends its session cookie with cross-site requests");
  }
  return [...reasons, ...policyReasons(app, config, reusable)];
}

function planPolicy(
  config: AccessGateConfig,
  observed: ObservedAccess,
): {
  finding: GateFinding;
  action: GateAction | null;
} {
  const body = allowPolicyBody(config);
  const label = `Access policy "${body.name}"`;
  const existing = observed.policies.find(
    (policy) => policy.name === body.name,
  );
  if (!existing) {
    return {
      action: { body, type: "create-policy" },
      finding: { detail: "does not exist yet", label, status: "missing" },
    };
  }
  const reasons: string[] = [];
  if (existing.decision !== "allow")
    reasons.push(`decides "${String(existing.decision)}", not allow`);
  if (
    !admitsOperators(existing, config) ||
    (existing.include ?? []).length !== config.operatorEmails.length
  ) {
    reasons.push(`does not admit exactly ${config.operatorEmails.join(", ")}`);
  }
  if (!requiresDomain(existing, config)) {
    reasons.push(`does not require an @${config.emailDomain} address`);
  }
  if (reasons.length === 0) {
    return {
      action: null,
      finding: {
        detail: `admits ${config.operatorEmails.join(", ")}`,
        label,
        status: "ok",
      },
    };
  }
  return {
    action: { body, id: existing.id, type: "update-policy" },
    finding: { detail: reasons.join("; "), label, status: "mismatch" },
  };
}

/**
 * Compares the live Access setup with the gate Atlas wants and lists what to
 * change. Changes run in order: the policy first, so the application can
 * attach it.
 */
export function planAccessGate(
  config: AccessGateConfig,
  observed: ObservedAccess,
): GatePlan {
  if (!observed.teamDomain) {
    return {
      actions: [],
      blocked: "Zero Trust is not turned on for this Cloudflare account.",
      findings: [],
    };
  }
  const provider = observed.providers.find(
    (candidate) => candidate.type === GOOGLE_WORKSPACE,
  );
  if (!provider) {
    return {
      actions: [],
      blocked: "Google Workspace is not an Access identity provider yet.",
      findings: [],
    };
  }

  const findings: GateFinding[] = [
    {
      detail: `is on; team domain ${observed.teamDomain}`,
      label: "Zero Trust",
      status: "ok",
    },
    {
      detail: `identity provider "${provider.name}"`,
      label: "Google Workspace sign-in",
      status: "ok",
    },
  ];
  const actions: GateAction[] = [];

  const policy = planPolicy(config, observed);
  findings.push(policy.finding);
  if (policy.action) actions.push(policy.action);

  const label = `Access application "${config.appName}"`;
  const found = findApp(observed.apps, config);
  if (!found) {
    findings.push({
      detail: `nothing protects ${config.hostname}`,
      label,
      status: "missing",
    });
    actions.push({ providerId: provider.id, type: "create-app" });
    return { actions, blocked: null, findings };
  }
  // Judge the application against the allow policy as it will be once this
  // plan runs, so a stale operator list is fixed once, in the policy.
  const plannedPolicies = observed.policies.map((candidate) =>
    policy.action?.type === "update-policy" && candidate.id === policy.action.id
      ? { ...policy.action.body, id: candidate.id }
      : candidate,
  );
  const reasons = appReasons(found, config, provider, plannedPolicies);
  if (reasons.length === 0) {
    findings.push({
      detail: `protects ${config.hostname} for ${config.operatorEmails.join(", ")}`,
      label,
      status: "ok",
    });
  } else {
    findings.push({ detail: reasons.join("; "), label, status: "mismatch" });
    actions.push({ found, providerId: provider.id, type: "update-app" });
  }
  return { actions, blocked: null, findings };
}
