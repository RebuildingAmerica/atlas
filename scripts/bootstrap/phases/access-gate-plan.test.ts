import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowPolicyBody,
  appBody,
  planAccessGate,
  type AccessApp,
  type AccessGateConfig,
  type ObservedAccess,
} from "./access-gate-plan.js";

const CONFIG: AccessGateConfig = {
  appName: "Atlas platform admin",
  emailDomain: "rebuildingus.org",
  hostname: "atlas-admin.rebuildingus.org",
  operatorEmails: ["willie@rebuildingus.org"],
  sessionDuration: "8h",
};

const GOOGLE = {
  id: "idp-google",
  name: "Google Workspace",
  type: "google-apps",
};
const OTP = { id: "idp-otp", name: "One-time PIN", type: "onetimepin" };

function observed(overrides: Partial<ObservedAccess> = {}): ObservedAccess {
  return {
    apps: [],
    policies: [],
    providers: [GOOGLE],
    teamDomain: "rebuildingus.cloudflareaccess.com",
    ...overrides,
  };
}

const MATCHING_POLICY = {
  id: "policy-1",
  ...allowPolicyBody(CONFIG),
};

function matchingApp(overrides: Partial<AccessApp> = {}): AccessApp {
  return {
    aud: "a".repeat(64),
    id: "app-1",
    ...appBody(CONFIG, GOOGLE.id, MATCHING_POLICY.id),
    ...overrides,
  };
}

void describe("allowPolicyBody", () => {
  void it("admits each operator by email and requires the organization's email domain", () => {
    assert.deepEqual(allowPolicyBody(CONFIG), {
      decision: "allow",
      include: [{ email: { email: "willie@rebuildingus.org" } }],
      name: "Atlas platform admin allow",
      require: [{ email_domain: { domain: "rebuildingus.org" } }],
    });
  });
});

void describe("appBody", () => {
  void it("protects the whole admin host with only Google Workspace, an 8 hour session and no launcher tile", () => {
    assert.deepEqual(appBody(CONFIG, GOOGLE.id, "policy-1"), {
      allowed_idps: [GOOGLE.id],
      app_launcher_visible: false,
      auto_redirect_to_identity: true,
      destinations: [{ type: "public", uri: "atlas-admin.rebuildingus.org" }],
      domain: "atlas-admin.rebuildingus.org",
      enable_binding_cookie: true,
      http_only_cookie_attribute: true,
      name: "Atlas platform admin",
      policies: [{ id: "policy-1", precedence: 1 }],
      same_site_cookie_attribute: "lax",
      session_duration: "8h",
      type: "self_hosted",
    });
  });

  void it("keeps other attached policies but detaches any that lets everyone in", () => {
    const body = appBody(CONFIG, GOOGLE.id, "policy-1", {
      existingPolicies: [
        { id: "policy-1" },
        { id: "bypass-health", precedence: 2 },
        { decision: "allow", id: "open", include: [{ everyone: {} }] },
      ],
      reusablePolicies: [],
    });

    assert.deepEqual(body.policies, [
      { id: "policy-1", precedence: 1 },
      { id: "bypass-health", precedence: 2 },
    ]);
  });

  void it("detaches a reusable policy that lets everyone in", () => {
    const body = appBody(CONFIG, GOOGLE.id, "policy-1", {
      existingPolicies: [{ id: "shared-open" }],
      reusablePolicies: [
        {
          decision: "allow",
          id: "shared-open",
          include: [{ everyone: {} }],
          name: "open",
        },
      ],
    });

    assert.deepEqual(body.policies, [{ id: "policy-1", precedence: 1 }]);
  });
});

void describe("planAccessGate", () => {
  void it("is blocked until Zero Trust is turned on for the account", () => {
    const plan = planAccessGate(CONFIG, observed({ teamDomain: null }));

    assert.equal(
      plan.blocked,
      "Zero Trust is not turned on for this Cloudflare account.",
    );
    assert.deepEqual(plan.actions, []);
  });

  void it("is blocked until Google Workspace is an identity provider", () => {
    const plan = planAccessGate(CONFIG, observed({ providers: [OTP] }));

    assert.equal(
      plan.blocked,
      "Google Workspace is not an Access identity provider yet.",
    );
    assert.deepEqual(plan.actions, []);
  });

  void it("creates the policy and the application when nothing protects the host", () => {
    const plan = planAccessGate(CONFIG, observed());

    assert.equal(plan.blocked, null);
    assert.deepEqual(
      plan.actions.map((action) => action.type),
      ["create-policy", "create-app"],
    );
    assert.ok(
      plan.findings.some(
        (finding) =>
          finding.status === "missing" &&
          finding.detail === "nothing protects atlas-admin.rebuildingus.org",
      ),
    );
  });

  void it("reports nothing to do when the live setup already matches", () => {
    const plan = planAccessGate(
      CONFIG,
      observed({ apps: [matchingApp()], policies: [MATCHING_POLICY] }),
    );

    assert.deepEqual(plan.actions, []);
    assert.ok(plan.findings.every((finding) => finding.status === "ok"));
  });

  void it("finds the application by its host when it has another name", () => {
    const plan = planAccessGate(
      CONFIG,
      observed({
        apps: [matchingApp({ name: "renamed" })],
        policies: [MATCHING_POLICY],
      }),
    );

    assert.deepEqual(plan.actions, []);
  });

  void it("finds the application by a host it lists among its destinations", () => {
    const app = matchingApp({ domain: undefined, name: "renamed" });

    const plan = planAccessGate(
      CONFIG,
      observed({ apps: [app], policies: [MATCHING_POLICY] }),
    );

    assert.deepEqual(plan.actions, []);
  });

  void it("finds the application by a legacy self-hosted domain list", () => {
    const app = matchingApp({
      destinations: undefined,
      domain: undefined,
      name: "renamed",
      self_hosted_domains: ["atlas-admin.rebuildingus.org"],
    });

    const plan = planAccessGate(
      CONFIG,
      observed({ apps: [app], policies: [MATCHING_POLICY] }),
    );

    assert.deepEqual(plan.actions, []);
  });

  void it("updates the policy when the operator list changed", () => {
    const stale = {
      ...MATCHING_POLICY,
      include: [{ email: { email: "old@rebuildingus.org" } }],
    };

    const plan = planAccessGate(
      CONFIG,
      observed({ apps: [matchingApp()], policies: [stale] }),
    );

    assert.deepEqual(
      plan.actions.map((action) => action.type),
      ["update-policy"],
    );
  });

  void it("restores the email-domain requirement when someone removed it", () => {
    const loose = { ...MATCHING_POLICY, require: [] };

    const plan = planAccessGate(
      CONFIG,
      observed({ apps: [matchingApp()], policies: [loose] }),
    );

    assert.deepEqual(
      plan.actions.map((action) => action.type),
      ["update-policy"],
    );
    assert.ok(
      plan.findings.some((finding) =>
        finding.detail.includes(
          "does not require an @rebuildingus.org address",
        ),
      ),
    );
  });

  const MISMATCHES: [string, Partial<AccessApp>, string][] = [
    [
      "a missing destination",
      { destinations: [], domain: "other.rebuildingus.org" },
      "does not protect atlas-admin.rebuildingus.org",
    ],
    [
      "a longer session",
      { session_duration: "24h" },
      "signs people in for 24h, not 8h",
    ],
    [
      "another identity provider",
      { allowed_idps: [OTP.id] },
      "does not offer Google Workspace",
    ],
    [
      "every identity provider",
      { allowed_idps: [] },
      "accepts every identity provider, not only Google Workspace",
    ],
    [
      "a launcher tile",
      { app_launcher_visible: true },
      "shows in the App Launcher",
    ],
    [
      "no instant redirect",
      { auto_redirect_to_identity: false },
      "does not send people straight to Google Workspace",
    ],
    [
      "no allow policy",
      { policies: [] },
      "has no allow policy for willie@rebuildingus.org",
    ],
    [
      "an unbound session cookie",
      { enable_binding_cookie: false },
      "does not bind its session cookie to the browser",
    ],
    [
      "a script-readable cookie",
      { http_only_cookie_attribute: false },
      "lets page scripts read its session cookie",
    ],
    [
      "a cross-site cookie",
      { same_site_cookie_attribute: "none" },
      "sends its session cookie with cross-site requests",
    ],
    [
      "an allow-everyone policy",
      {
        policies: [
          { id: "policy-1" },
          { decision: "allow", id: "open", include: [{ everyone: {} }] },
        ],
      },
      "has an allow policy that lets everyone in",
    ],
  ];

  for (const [label, overrides, reason] of MISMATCHES) {
    void it(`updates the application when it has ${label}`, () => {
      const plan = planAccessGate(
        CONFIG,
        observed({
          apps: [matchingApp(overrides)],
          policies: [MATCHING_POLICY],
        }),
      );

      assert.deepEqual(
        plan.actions.map((action) => action.type),
        ["update-app"],
      );
      const finding = plan.findings.find(
        (candidate) => candidate.status === "mismatch",
      );
      assert.ok(
        finding?.detail.includes(reason),
        `expected "${reason}" in ${finding?.detail}`,
      );
    });
  }

  void it("counts an inline allow policy for the operator as admitting them", () => {
    const app = matchingApp({
      policies: [{ id: "inline", ...allowPolicyBody(CONFIG) }],
    });

    const plan = planAccessGate(
      CONFIG,
      observed({ apps: [app], policies: [MATCHING_POLICY] }),
    );

    assert.deepEqual(plan.actions, []);
  });

  void it("treats operator emails in any case as the same people", () => {
    const shouting = {
      ...MATCHING_POLICY,
      include: [{ email: { email: "WILLIE@RebuildingUS.org" } }],
    };

    const plan = planAccessGate(
      CONFIG,
      observed({ apps: [matchingApp()], policies: [shouting] }),
    );

    assert.deepEqual(plan.actions, []);
  });
});
