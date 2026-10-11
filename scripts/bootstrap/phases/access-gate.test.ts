import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CfCommandError, type CfRunner } from "../lib/cf.js";
import type {
  AccessApp,
  AccessGateConfig,
  AccessPolicy,
} from "./access-gate-plan.js";
import { allowPolicyBody } from "./access-gate-plan.js";
import {
  applyAccessGate,
  observeAccess,
  readAccessGateConfig,
  reconcileAccessGate,
} from "./access-gate.js";

const CONFIG: AccessGateConfig = {
  appName: "Atlas platform admin",
  emailDomain: "rebuildingus.org",
  hostname: "atlas-admin.rebuildingus.org",
  operatorEmails: ["willie@rebuildingus.org"],
  sessionDuration: "8h",
};

interface FakeAccount {
  organization: { auth_domain: string } | null;
  providers: { id: string; name: string; type: string }[];
  apps: AccessApp[];
  policies: AccessPolicy[];
}

/** A stand-in for `cf` that keeps one Cloudflare account's Access state in memory. */
function fakeCf(
  account: FakeAccount,
  pageSize = 2,
): { run: CfRunner; writes: string[] } {
  const writes: string[] = [];
  let next = 1;
  const page = (items: unknown[], args: string[]): unknown[] => {
    const number = Number(args[args.indexOf("--page") + 1]);
    const size = Math.min(
      pageSize,
      Number(args[args.indexOf("--per-page") + 1]),
    );
    return items.slice((number - 1) * size, number * size);
  };
  const run: CfRunner = (args, body) => {
    const command = args
      .filter((arg) => !arg.startsWith("--") && !/^\d+$/.test(arg))
      .join(" ");
    switch (command) {
      case "zero-trust organizations list":
        if (!account.organization)
          throw new CfCommandError(command, "organization not found");
        return account.organization;
      case "zero-trust identity-providers list":
        return page(account.providers, args);
      case "zero-trust access applications list":
        return page(account.apps, args);
      case "zero-trust access policies list":
        return page(account.policies, args);
      case "zero-trust access policies create": {
        writes.push(command);
        const created = { id: `policy-${String(next++)}`, ...(body ?? {}) };
        account.policies.push(created);
        return created;
      }
      case "zero-trust access applications create": {
        writes.push(command);
        const created = {
          aud: "f".repeat(64),
          id: `app-${String(next++)}`,
          ...(body ?? {}),
        };
        account.apps.push(created);
        return created;
      }
    }
    const [id] = args.slice(-1);
    if (command.startsWith("zero-trust access policies update")) {
      writes.push("zero-trust access policies update");
      const index = account.policies.findIndex((policy) => policy.id === id);
      account.policies[index] = { id: id ?? "", ...(body ?? {}) };
      return account.policies[index];
    }
    if (command.startsWith("zero-trust access applications update")) {
      writes.push("zero-trust access applications update");
      const index = account.apps.findIndex((app) => app.id === id);
      const previous = account.apps[index];
      account.apps[index] = {
        aud: previous?.aud,
        id: id ?? "",
        ...(body ?? {}),
      };
      return account.apps[index];
    }
    throw new Error(`unexpected cf command: ${args.join(" ")}`);
  };
  return { run, writes };
}

function emptyAccount(): FakeAccount {
  return {
    apps: [],
    organization: { auth_domain: "rebuildingus.cloudflareaccess.com" },
    policies: [],
    providers: [
      { id: "idp-google", name: "Google Workspace", type: "google-apps" },
    ],
  };
}

void describe("observeAccess", () => {
  void it("reads every page of each list", () => {
    const account = emptyAccount();
    account.apps = [1, 2, 3, 4, 5].map((n) => ({
      id: `app-${String(n)}`,
      name: `app ${String(n)}`,
    }));
    const { run } = fakeCf(account, 2);

    const observed = observeAccess(run);

    assert.equal(observed.apps.length, 5);
    assert.equal(observed.teamDomain, "rebuildingus.cloudflareaccess.com");
  });

  void it("stops rather than loops when an endpoint repeats the same page", () => {
    const { run } = fakeCf(emptyAccount());
    const repeating: CfRunner = (args, body) =>
      args.includes("applications")
        ? [{ id: "same", name: "same" }]
        : run(args, body);

    assert.throws(
      () => observeAccess(repeating),
      /returned more than 50 pages/,
    );
  });

  void it("lets an unexpected failure reading the organization through", () => {
    const failing: CfRunner = () => {
      throw new TypeError("network down");
    };

    assert.throws(() => observeAccess(failing), /network down/);
  });

  void it("reports Zero Trust as off when the account has no organization", () => {
    const { run } = fakeCf({ ...emptyAccount(), organization: null });

    assert.equal(observeAccess(run).teamDomain, null);
  });
});

void describe("reconcileAccessGate", () => {
  void it("creates the gate from nothing and returns what the admin app needs", () => {
    const account = emptyAccount();
    const { run, writes } = fakeCf(account);

    const result = reconcileAccessGate(run, CONFIG);

    assert.deepEqual(writes, [
      "zero-trust access policies create",
      "zero-trust access applications create",
    ]);
    assert.deepEqual(result.outputs, {
      ATLAS_ACCESS_AUD: "f".repeat(64),
      ATLAS_ACCESS_TEAM_DOMAIN: "rebuildingus.cloudflareaccess.com",
    });
    assert.deepEqual(account.apps[0]?.policies, [
      { id: account.policies[0]?.id, precedence: 1 },
    ]);
  });

  void it("changes nothing the second time it runs", () => {
    const account = emptyAccount();
    const first = fakeCf(account);
    reconcileAccessGate(first.run, CONFIG);
    const second = fakeCf(account);

    const result = reconcileAccessGate(second.run, CONFIG);

    assert.deepEqual(second.writes, []);
    assert.ok(result.plan.findings.every((finding) => finding.status === "ok"));
    assert.equal(result.outputs?.ATLAS_ACCESS_AUD, "f".repeat(64));
  });

  void it("repairs a widened session and a stale operator list in place", () => {
    const account = emptyAccount();
    reconcileAccessGate(fakeCf(account).run, CONFIG);
    const policy = account.policies[0];
    const app = account.apps[0];
    assert.ok(policy && app);
    policy.include = [{ email: { email: "someone-else@rebuildingus.org" } }];
    app.session_duration = "720h";
    const repair = fakeCf(account);

    reconcileAccessGate(repair.run, CONFIG);

    assert.deepEqual(repair.writes, [
      "zero-trust access policies update",
      "zero-trust access applications update",
    ]);
    assert.deepEqual(account.policies[0], {
      id: policy.id,
      ...allowPolicyBody(CONFIG),
    });
    assert.equal(account.apps[0]?.session_duration, "8h");
    assert.equal(account.apps[0]?.aud, "f".repeat(64));
  });

  void it("only reports in doctor mode", () => {
    const account = emptyAccount();
    const { run, writes } = fakeCf(account);

    const result = reconcileAccessGate(run, CONFIG, { doctor: true });

    assert.deepEqual(writes, []);
    assert.equal(result.outputs, null);
    assert.deepEqual(
      result.plan.actions.map((action) => action.type),
      ["create-policy", "create-app"],
    );
  });

  void it("stops before writing anything when the plan is blocked", () => {
    const { run, writes } = fakeCf({ ...emptyAccount(), providers: [] });

    const result = reconcileAccessGate(run, CONFIG);

    assert.deepEqual(writes, []);
    assert.equal(result.outputs, null);
    assert.equal(
      result.plan.blocked,
      "Google Workspace is not an Access identity provider yet.",
    );
  });
});

void describe("applyAccessGate", () => {
  void it("refuses an application the API returns without an audience tag", () => {
    const account = emptyAccount();
    const { run } = fakeCf(account);
    const observed = observeAccess(run);
    const brokenRun: CfRunner = (args, body) =>
      args.join(" ").includes("applications create")
        ? { id: "app-x" }
        : run(args, body);

    assert.throws(
      () =>
        applyAccessGate(
          brokenRun,
          CONFIG,
          {
            actions: [{ providerId: "idp-google", type: "create-app" }],
            blocked: null,
            findings: [],
          },
          {
            ...observed,
            policies: [{ id: "policy-1", ...allowPolicyBody(CONFIG) }],
          },
        ),
      /did not return an audience tag/,
    );
  });
});

void describe("readAccessGateConfig", () => {
  void it("gives staging its own Access app and policy without changing production", () => {
    const env = new Map([
      [
        "ATLAS_ADMIN_PUBLIC_URL",
        "https://atlas-admin-staging.rebuildingus.org",
      ],
      ["ATLAS_PLATFORM_OPERATOR_EMAILS", "willie@rebuildingus.org"],
      ["ATLAS_ACCESS_EMAIL_DOMAIN", "rebuildingus.org"],
    ]);
    const staging = readAccessGateConfig(env, "staging");
    assert.equal(staging.appName, "Atlas platform admin staging");
    assert.equal(
      allowPolicyBody(staging).name,
      "Atlas platform admin staging allow",
    );
    assert.throws(
      () => readAccessGateConfig(env, "production"),
      /does not match/,
    );
    env.set("ATLAS_ADMIN_PUBLIC_URL", "https://atlas-admin.rebuildingus.org");
    assert.throws(() => readAccessGateConfig(env, "staging"), /does not match/);
  });
  void it("reads the admin host, operators and email domain", () => {
    const env = new Map([
      ["ATLAS_ADMIN_PUBLIC_URL", "https://atlas-admin.rebuildingus.org/"],
      ["ATLAS_PLATFORM_OPERATOR_EMAILS", " Willie@RebuildingUS.org , "],
      ["ATLAS_ACCESS_EMAIL_DOMAIN", "rebuildingus.org"],
    ]);

    assert.deepEqual(readAccessGateConfig(env, "production"), CONFIG);
  });

  const MISSING: [string, Map<string, string>, string][] = [
    ["no admin host", new Map<string, string>(), "ATLAS_ADMIN_PUBLIC_URL"],
    [
      "no operators",
      new Map([
        ["ATLAS_ADMIN_PUBLIC_URL", "https://atlas-admin.rebuildingus.org"],
      ]),
      "ATLAS_PLATFORM_OPERATOR_EMAILS",
    ],
    [
      "no email domain",
      new Map([
        ["ATLAS_ADMIN_PUBLIC_URL", "https://atlas-admin.rebuildingus.org"],
        ["ATLAS_PLATFORM_OPERATOR_EMAILS", "willie@rebuildingus.org"],
      ]),
      "ATLAS_ACCESS_EMAIL_DOMAIN",
    ],
    [
      "an operator outside the email domain",
      new Map([
        ["ATLAS_ADMIN_PUBLIC_URL", "https://atlas-admin.rebuildingus.org"],
        ["ATLAS_PLATFORM_OPERATOR_EMAILS", "willie@gmail.com"],
        ["ATLAS_ACCESS_EMAIL_DOMAIN", "rebuildingus.org"],
      ]),
      "willie@gmail.com is not an @rebuildingus.org address",
    ],
  ];

  for (const [label, env, message] of MISSING) {
    void it(`refuses config with ${label}`, () => {
      assert.throws(
        () => readAccessGateConfig(env, "production"),
        new RegExp(message),
      );
    });
  }
});
