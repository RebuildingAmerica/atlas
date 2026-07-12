export const CLOUD_COST_POLICY = {
  artifactRegistryFreeGiB: 0.5,
  cloudRun: {
    maxConcurrency: 1,
    maxCpu: 1,
    maxMemoryMiB: 768,
  },
  rollbackImageCount: 5,
  untaggedImageMaxAge: "86400s",
};

function statusFromBlockers(blockers) {
  return blockers.length === 0 ? "pass" : "block";
}

function parseCpu(cpu) {
  if (typeof cpu === "number") {
    return cpu;
  }
  if (typeof cpu !== "string" || cpu.trim() === "") {
    return 0;
  }
  const normalized = cpu.trim();
  if (normalized.endsWith("m")) {
    return Number(normalized.slice(0, -1)) / 1000;
  }
  return Number(normalized);
}

function parseMemoryMiB(memory) {
  if (typeof memory !== "string" || memory.trim() === "") {
    return 0;
  }
  const normalized = memory.trim();
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (normalized.endsWith("Gi")) {
    return value * 1024;
  }
  if (normalized.endsWith("Mi")) {
    return value;
  }
  if (normalized.endsWith("G")) {
    return (value * 1000) / 1.048576;
  }
  if (normalized.endsWith("M")) {
    return value / 1.048576;
  }
  return value / 1024 / 1024;
}

function serviceAnnotations(service) {
  return (
    service?.template?.annotations ??
    service?.spec?.template?.metadata?.annotations ??
    {}
  );
}

function serviceTemplateSpec(service) {
  return service?.template ?? service?.spec?.template?.spec ?? {};
}

export function evaluateCloudRunCostPosture(service) {
  const annotations = serviceAnnotations(service);
  const templateSpec = serviceTemplateSpec(service);
  const container = templateSpec.containers?.[0] ?? {};
  const limits = container.resources?.limits ?? {};
  const blockers = [];
  const warnings = [];

  const minScale = annotations["autoscaling.knative.dev/minScale"] ?? "0";
  if (String(minScale) !== "0") {
    blockers.push(
      "Cloud Run min instances must stay at 0 unless an operator approves paid idle.",
    );
  }

  if (annotations["run.googleapis.com/cpu-throttling"] === "false") {
    blockers.push(
      "Cloud Run CPU must stay request-allocated; always-allocated CPU creates idle cost.",
    );
  }

  const cpu = parseCpu(limits.cpu);
  if (cpu > CLOUD_COST_POLICY.cloudRun.maxCpu) {
    blockers.push(
      `Cloud Run CPU limit ${limits.cpu} exceeds policy maximum ${CLOUD_COST_POLICY.cloudRun.maxCpu}.`,
    );
  }

  const memoryMiB = parseMemoryMiB(limits.memory);
  if (memoryMiB > CLOUD_COST_POLICY.cloudRun.maxMemoryMiB) {
    blockers.push(
      `Cloud Run memory limit ${limits.memory} exceeds policy maximum ${CLOUD_COST_POLICY.cloudRun.maxMemoryMiB}Mi.`,
    );
  }

  const concurrency = Number(templateSpec.containerConcurrency ?? 0);
  if (concurrency > CLOUD_COST_POLICY.cloudRun.maxConcurrency) {
    warnings.push(
      `Cloud Run concurrency ${concurrency} exceeds policy target ${CLOUD_COST_POLICY.cloudRun.maxConcurrency}; verify user-visible latency before deploy.`,
    );
  }

  return {
    blockers,
    serviceName: service?.name ?? service?.metadata?.name ?? "unknown",
    status: statusFromBlockers(blockers),
    warnings,
  };
}

export function evaluateRepositoryCostPosture(repository) {
  const blockers = [];
  const warnings = [];
  const cleanupPolicies = repository?.cleanupPolicies;

  if (
    cleanupPolicies === null ||
    cleanupPolicies === undefined ||
    cleanupPolicies === ""
  ) {
    blockers.push(
      "Artifact Registry cleanup policy is required before deploy. Run `pnpm bootstrap` to apply it automatically.",
    );
  }

  if (repository?.cleanupPolicyDryRun === true) {
    warnings.push("Artifact Registry cleanup policy is still in dry-run mode.");
  }

  const sizeBytes = Number(repository?.sizeBytes ?? 0);
  const freeBytes =
    CLOUD_COST_POLICY.artifactRegistryFreeGiB * 1024 * 1024 * 1024;
  if (Number.isFinite(sizeBytes) && sizeBytes > freeBytes) {
    warnings.push(
      `Artifact Registry size ${(sizeBytes / 1024 / 1024).toFixed(1)} MiB exceeds the ${CLOUD_COST_POLICY.artifactRegistryFreeGiB} GiB free allowance.`,
    );
  }

  return {
    blockers,
    repositoryName: repository?.name ?? "unknown",
    status: statusFromBlockers(blockers),
    warnings,
  };
}

export function buildArtifactCleanupPolicy() {
  return [
    {
      name: "delete-untagged-api-images",
      action: { type: "Delete" },
      condition: {
        olderThan: CLOUD_COST_POLICY.untaggedImageMaxAge,
        packageNamePrefixes: ["atlas-api"],
        tagState: "untagged",
      },
    },
    {
      name: "keep-recent-api-images",
      action: { type: "Keep" },
      mostRecentVersions: {
        keepCount: CLOUD_COST_POLICY.rollbackImageCount,
        packageNamePrefixes: ["atlas-api"],
      },
    },
  ];
}

export function summarizeCostPosture(postures) {
  const blockers = postures.flatMap((posture) => posture.blockers);
  const warnings = postures.flatMap((posture) => posture.warnings);
  return {
    blockers,
    status: statusFromBlockers(blockers),
    warnings,
  };
}
