/**
 * A project can report billingEnabled=true while its billing account is closed.
 * Reject that state before provisioning so a hosting switch cannot strand
 * search, profile rendering or sign-in on an unusable Cloud Run origin.
 */
export function inspectGoogleBilling({ project, account, tool }) {
  if (!project) throw new Error("GCP_PROJECT_ID is required.");
  const accountArgs = account ? [`--account=${account}`] : [];
  const projectBilling = JSON.parse(
    tool("gcloud", [
      "billing",
      "projects",
      "describe",
      project,
      "--format=json",
      ...accountArgs,
    ]),
  );
  if (
    projectBilling.projectId !== project ||
    projectBilling.billingEnabled !== true ||
    !/^billingAccounts\/[A-Za-z0-9-]+$/.test(
      projectBilling.billingAccountName ?? "",
    )
  )
    throw new Error(
      "The selected Google Cloud project has no verified billing link.",
    );
  const billingAccountId = projectBilling.billingAccountName.split("/")[1];
  const billing = JSON.parse(
    tool("gcloud", [
      "billing",
      "accounts",
      "describe",
      billingAccountId,
      "--format=json",
      ...accountArgs,
    ]),
  );
  if (billing.name !== projectBilling.billingAccountName)
    throw new Error(
      "Google Cloud billing account readback does not match the project.",
    );
  if (billing.open === false)
    throw new Error(
      "The linked Google Cloud billing account is closed; hybrid hosting is blocked.",
    );
  if (billing.open !== true)
    throw new Error("Google Cloud billing account status is unavailable.");
  return {
    projectId: project,
    billingAccountId,
    open: true,
    ...(/^organizations\/[0-9]+$/.test(billing.parent ?? "")
      ? { organizationId: billing.parent.split("/")[1] }
      : {}),
  };
}

/** Grant only account-status reading; never billing management or payment access. */
export function bootstrapGoogleBilling({ project, account, tool }) {
  if (!account)
    throw new Error("ATLAS_GCP_ACCOUNT is required for billing bootstrap.");
  const billing = inspectGoogleBilling({ project, account, tool });
  if (!billing.organizationId)
    throw new Error(
      "A billing organization is required for the custom status-reader role; no broader role was granted.",
    );
  const accountArgs = [`--account=${account}`];
  const email = `atlas-deploy@${project}.iam.gserviceaccount.com`;
  const identity = JSON.parse(
    tool("gcloud", [
      "iam",
      "service-accounts",
      "describe",
      email,
      `--project=${project}`,
      "--format=json",
      ...accountArgs,
    ]),
  );
  if (identity.email !== email || identity.disabled === true)
    throw new Error(
      "The Atlas deployment service account is missing or disabled; run repository infrastructure bootstrap first.",
    );
  const roleId = "atlasWebBillingStatusReader";
  const role = `organizations/${billing.organizationId}/roles/${roleId}`;
  const roleArgs = [
    `--organization=${billing.organizationId}`,
    "--format=json",
    ...accountArgs,
  ];
  const roles = JSON.parse(
    tool("gcloud", [
      "iam",
      "roles",
      "list",
      ...roleArgs,
      `--filter=name=${role}`,
      "--show-deleted",
    ]),
  );
  if (
    !Array.isArray(roles) ||
    roles.length > 1 ||
    (roles.length === 1 && roles[0].name !== role)
  )
    throw new Error("Billing status-reader role inventory is unavailable.");
  if (roles.length === 0)
    tool("gcloud", [
      "iam",
      "roles",
      "create",
      roleId,
      ...roleArgs,
      "--title=Atlas web billing status reader",
      "--permissions=billing.accounts.get",
      "--stage=GA",
      "--quiet",
    ]);
  const observedRole = JSON.parse(
    tool("gcloud", ["iam", "roles", "describe", roleId, ...roleArgs]),
  );
  if (
    observedRole.name !== role ||
    observedRole.deleted === true ||
    observedRole.stage !== "GA" ||
    !Array.isArray(observedRole.includedPermissions) ||
    observedRole.includedPermissions.length !== 1 ||
    observedRole.includedPermissions[0] !== "billing.accounts.get"
  )
    throw new Error(
      "Billing status-reader role must contain exactly billing.accounts.get; no binding was added.",
    );
  const member = `serviceAccount:${email}`;
  const readPolicy = () =>
    JSON.parse(
      tool("gcloud", [
        "billing",
        "accounts",
        "get-iam-policy",
        billing.billingAccountId,
        "--format=json",
        ...accountArgs,
      ]),
    );
  const hasBinding = (policy) => {
    if (!Array.isArray(policy.bindings))
      throw new Error("Billing IAM policy is unavailable.");
    return policy.bindings.some(
      (binding) =>
        binding.role === role &&
        !binding.condition &&
        binding.members?.includes(member),
    );
  };
  if (!hasBinding(readPolicy()))
    tool("gcloud", [
      "billing",
      "accounts",
      "add-iam-policy-binding",
      billing.billingAccountId,
      `--member=${member}`,
      `--role=${role}`,
      "--format=json",
      "--quiet",
      ...accountArgs,
    ]);
  if (!hasBinding(readPolicy()))
    throw new Error("Billing status-reader binding failed readback.");
  return { ...billing, serviceAccount: email, role };
}
