import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inspectGoogleBilling,
  bootstrapGoogleBilling,
} from "./web-google-cloud.mjs";
import { doctor } from "./web-hosting.mjs";

function provider({ enabled = true, open = true, linked = true } = {}) {
  const calls = [];
  return {
    calls,
    tool(binary, args) {
      calls.push({ binary, args });
      if (args[1] === "projects")
        return JSON.stringify({
          projectId: "atlas-project",
          billingEnabled: enabled,
          billingAccountName: linked ? "billingAccounts/ABC-DEF" : "",
        });
      return JSON.stringify({ name: "billingAccounts/ABC-DEF", open });
    },
  };
}

test("billing inspection reads the explicit project and linked account without changing CLI defaults", () => {
  const mock = provider();
  assert.deepEqual(
    inspectGoogleBilling({
      project: "atlas-project",
      account: "atlas-operator@example.com",
      tool: mock.tool,
    }),
    { projectId: "atlas-project", billingAccountId: "ABC-DEF", open: true },
  );
  assert.deepEqual(mock.calls, [
    {
      binary: "gcloud",
      args: [
        "billing",
        "projects",
        "describe",
        "atlas-project",
        "--format=json",
        "--account=atlas-operator@example.com",
      ],
    },
    {
      binary: "gcloud",
      args: [
        "billing",
        "accounts",
        "describe",
        "ABC-DEF",
        "--format=json",
        "--account=atlas-operator@example.com",
      ],
    },
  ]);
});

test("a closed billing account blocks hosting even when the project claims billing is enabled", () => {
  const mock = provider({ open: false });
  assert.throws(
    () => inspectGoogleBilling({ project: "atlas-project", tool: mock.tool }),
    /billing account is closed/,
  );
  assert.equal(mock.calls.length, 2);
});

test("disabled, unlinked, mismatched or unknown billing state never passes", () => {
  for (const settings of [
    { enabled: false },
    { linked: false },
    { open: null },
  ]) {
    const mock = provider(settings);
    assert.throws(() =>
      inspectGoogleBilling({ project: "atlas-project", tool: mock.tool }),
    );
  }
  for (const payload of [
    {},
    {
      projectId: "other-project",
      billingEnabled: true,
      billingAccountName: "billingAccounts/ABC-DEF",
    },
    {
      projectId: "atlas-project",
      billingEnabled: true,
      billingAccountName: "billingAccounts/ABC-DEF/extra",
    },
  ])
    assert.throws(() =>
      inspectGoogleBilling({
        project: "atlas-project",
        tool: () => JSON.stringify(payload),
      }),
    );
  const mock = provider();
  assert.throws(() =>
    inspectGoogleBilling({
      project: "atlas-project",
      tool: (binary, args) =>
        args[1] === "projects"
          ? mock.tool(binary, args)
          : JSON.stringify({ name: "billingAccounts/OTHER", open: true }),
    }),
  );
});

test("CI can use its existing workload identity without an account override", () => {
  const mock = provider();
  inspectGoogleBilling({ project: "atlas-project", tool: mock.tool });
  assert.ok(
    mock.calls.every(({ args }) =>
      args.every((arg) => !arg.startsWith("--account=")),
    ),
  );
});

test("doctor reports closed billing as a blocker before listing deployable services", async () => {
  const keys = ["GCP_PROJECT_ID", "GCP_REGION", "ATLAS_GCP_ACCOUNT"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GCP_PROJECT_ID: "atlas-project",
    GCP_REGION: "us-central1",
    ATLAS_GCP_ACCOUNT: "atlas-operator@example.com",
  });
  const mock = provider({ open: false });
  try {
    const output = await doctor({
      target: "staging",
      cloudflare: () => [],
      fetcher: async () => new Response("{}", { status: 403 }),
      tool: mock.tool,
    });
    const check = output.checks.find((item) => item.name === "google-cloud");
    assert.equal(check.status, "block");
    assert.match(check.reason, /billing account is closed/);
    assert.equal(mock.calls.length, 2);
    assert.ok(mock.calls.every(({ args }) => args[0] === "billing"));
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

function bootstrapProvider({
  open = true,
  parent = "organizations/123",
  permissions = ["billing.accounts.get"],
  disabled = false,
  refuseBinding = false,
} = {}) {
  const calls = [];
  let created = false;
  let bound = false;
  const role = "organizations/123/roles/atlasWebBillingStatusReader";
  const member =
    "serviceAccount:atlas-deploy@atlas-project.iam.gserviceaccount.com";
  return {
    calls,
    tool(binary, args) {
      calls.push({ binary, args });
      if (args[0] === "billing" && args[1] === "projects")
        return JSON.stringify({
          projectId: "atlas-project",
          billingEnabled: true,
          billingAccountName: "billingAccounts/ABC-DEF",
        });
      if (args[0] === "billing" && args[2] === "describe")
        return JSON.stringify({
          name: "billingAccounts/ABC-DEF",
          open,
          parent,
        });
      if (args[1] === "service-accounts")
        return JSON.stringify({
          email: member.slice("serviceAccount:".length),
          disabled,
        });
      if (args[1] === "roles") {
        if (args[2] === "list")
          return JSON.stringify(created ? [{ name: role }] : []);
        if (args[2] === "create") {
          created = true;
          return "{}";
        }
        if (args[2] === "describe")
          return JSON.stringify({
            name: role,
            stage: "GA",
            includedPermissions: permissions,
          });
      }
      if (args[2] === "get-iam-policy")
        return JSON.stringify({
          bindings: bound ? [{ role, members: [member] }] : [],
        });
      if (args[2] === "add-iam-policy-binding") {
        bound = !refuseBinding;
        return "{}";
      }
      throw new Error(`Unexpected command: ${binary} ${args.join(" ")}`);
    },
  };
}

test("billing bootstrap creates a one-permission organization role, binds only the Atlas identity and verifies readback", () => {
  const mock = bootstrapProvider();
  const inputs = {
    project: "atlas-project",
    account: "atlas-operator@example.com",
    tool: mock.tool,
  };
  const result = bootstrapGoogleBilling(inputs);
  assert.equal(
    result.role,
    "organizations/123/roles/atlasWebBillingStatusReader",
  );
  const create = mock.calls.find(({ args }) => args[2] === "create");
  assert.ok(create.args.includes("--permissions=billing.accounts.get"));
  assert.ok(create.args.includes("--organization=123"));
  const bind = mock.calls.find(
    ({ args }) => args[2] === "add-iam-policy-binding",
  );
  assert.ok(bind.args.includes("ABC-DEF"));
  assert.ok(
    bind.args.includes(
      "--member=serviceAccount:atlas-deploy@atlas-project.iam.gserviceaccount.com",
    ),
  );
  assert.ok(bind.args.includes(`--role=${result.role}`));
  assert.equal(mock.calls.at(-1).args[2], "get-iam-policy");
  assert.ok(
    mock.calls.every(({ args }) =>
      args.includes("--account=atlas-operator@example.com"),
    ),
  );
  const count = mock.calls.length;
  bootstrapGoogleBilling(inputs);
  assert.ok(
    mock.calls
      .slice(count)
      .every(
        ({ args }) => !["create", "add-iam-policy-binding"].includes(args[2]),
      ),
  );
});

test("billing bootstrap blocks closed accounts or missing organizations before any IAM mutation", () => {
  for (const settings of [
    { open: false },
    { parent: "" },
    { disabled: true },
  ]) {
    const mock = bootstrapProvider(settings);
    assert.throws(() =>
      bootstrapGoogleBilling({
        project: "atlas-project",
        account: "operator@example.com",
        tool: mock.tool,
      }),
    );
    assert.ok(
      mock.calls.every(
        ({ args }) => !["create", "add-iam-policy-binding"].includes(args[2]),
      ),
    );
  }
});

test("billing bootstrap refuses a broader role and a failed binding readback", () => {
  const wider = bootstrapProvider({
    permissions: ["billing.accounts.get", "billing.accounts.reopen"],
  });
  assert.throws(
    () =>
      bootstrapGoogleBilling({
        project: "atlas-project",
        account: "operator@example.com",
        tool: wider.tool,
      }),
    /exactly billing.accounts.get/,
  );
  assert.ok(
    wider.calls.every(({ args }) => args[2] !== "add-iam-policy-binding"),
  );
  const refused = bootstrapProvider({ refuseBinding: true });
  assert.throws(
    () =>
      bootstrapGoogleBilling({
        project: "atlas-project",
        account: "operator@example.com",
        tool: refused.tool,
      }),
    /failed readback/,
  );
});
