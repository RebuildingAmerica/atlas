import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAtlasApiImageSpec,
  classifyDockerPreflight,
  formatDockerBuildFallbackPrompt,
  formatDockerDaemonRecovery,
  formatDockerStartPrompt,
  formatCloudBuildSourceAccessFollowUp,
  formatCloudBuildSourceAccessGrantCommand,
  formatCloudBuildSourceAccessRecoveryNote,
  formatCloudBuildDockerConfig,
  formatCloudRunEnvVarsFileContent,
  formatCloudBuildSubmitCommand,
  formatDockerBuildCommand,
  formatBootstrapImageTag,
  formatGcloudReauthenticationRecovery,
  isGcloudReauthenticationFailure,
  parseCloudBuildSourceAccessFailure,
  resolveDockerBuildPlan,
} from "./deploy.js";

void describe("deploy resilience", () => {
  void it("classifies a stopped Docker daemon as a blocked deploy preflight", () => {
    const preflight = classifyDockerPreflight({
      ok: false,
      stdout: "",
      stderr:
        "failed to connect to the docker API at unix:///Users/williecubed/.docker/run/docker.sock",
    });

    assert.equal(preflight.status, "blocked");
    assert.equal(preflight.reason, "daemon-unavailable");
  });

  void it("tells the operator how to recover from a stopped Docker daemon", () => {
    const recovery = formatDockerDaemonRecovery();

    assert.match(recovery, /Start Docker Desktop/);
    assert.match(recovery, /docker info/);
    assert.match(recovery, /pnpm bootstrap --resume/);
  });

  void it("offers to start Docker Desktop before falling back to Cloud Build", () => {
    const startPrompt = formatDockerStartPrompt();
    const fallbackPrompt = formatDockerBuildFallbackPrompt();

    assert.match(startPrompt, /Start Docker Desktop now/);
    assert.match(startPrompt, /wait until Docker is ready/);
    assert.match(fallbackPrompt, /Google Cloud Build/);
  });

  void it("builds atlas-api from the monorepo root with the API Dockerfile", () => {
    const repoRoot = "/repo/atlas";
    const imageTag =
      "us-central1-docker.pkg.dev/rap-atlas-prod/atlas-images/atlas-api:initial";
    const plan = resolveDockerBuildPlan({
      projectRoot: repoRoot,
      serviceRoot: "api",
      dockerfileContent: [
        "COPY libs/shared libs/shared",
        "COPY libs/discovery-engine libs/discovery-engine",
        "COPY api/atlas api/atlas",
      ].join("\n"),
    });

    assert.deepEqual(plan, {
      contextDir: repoRoot,
      dockerfilePath: "/repo/atlas/api/Dockerfile",
      cloudBuildDockerfilePath: "api/Dockerfile",
    });

    const dockerCommand = formatDockerBuildCommand(
      plan.contextDir,
      plan.dockerfilePath,
      imageTag,
    );
    assert.match(dockerCommand, /docker build/);
    assert.match(dockerCommand, /--file="\/repo\/atlas\/api\/Dockerfile"/);
    assert.match(dockerCommand, /"\/repo\/atlas"$/);

    const cloudBuildConfig = formatCloudBuildDockerConfig(
      plan.cloudBuildDockerfilePath,
      imageTag,
    );
    assert.match(cloudBuildConfig, /"gcr.io\/cloud-builders\/docker"/);
    assert.match(cloudBuildConfig, /"api\/Dockerfile"/);
    assert.match(cloudBuildConfig, /"images": \[/);

    const cloudBuildCommand = formatCloudBuildSubmitCommand(
      repoRoot,
      "/tmp/cloudbuild.json",
    );
    assert.match(cloudBuildCommand, /gcloud builds submit/);
    assert.match(cloudBuildCommand, /--config="\/tmp\/cloudbuild\.json"/);
    assert.match(cloudBuildCommand, /"\/repo\/atlas"/);
  });

  void it("keeps the atlas-api Dockerfile path separate from the image tag", () => {
    const imageBase = "us-central1-docker.pkg.dev/rap-atlas-prod/atlas-images";
    const imageTag = formatBootstrapImageTag(
      imageBase,
      new Date("2026-07-11T02:14:30.000Z"),
    );
    const spec = buildAtlasApiImageSpec({
      projectRoot: "/repo/atlas",
      imageBase,
      imageTag,
      dockerfileContent: [
        "COPY libs/shared libs/shared",
        "COPY libs/discovery-engine libs/discovery-engine",
        "COPY api/atlas api/atlas",
      ].join("\n"),
    });

    assert.deepEqual(spec, {
      serviceName: "atlas-api",
      contextDir: "/repo/atlas",
      dockerfilePath: "/repo/atlas/api/Dockerfile",
      cloudBuildDockerfilePath: "api/Dockerfile",
      imageTag,
    });
    assert.notEqual(spec.imageTag, spec.cloudBuildDockerfilePath);
  });

  void it("formats bootstrap image tags without depending on git state", () => {
    assert.equal(
      formatBootstrapImageTag(
        "us-central1-docker.pkg.dev/rap-atlas-prod/atlas-images",
        new Date("2026-07-11T02:14:30.000Z"),
      ),
      "us-central1-docker.pkg.dev/rap-atlas-prod/atlas-images/atlas-api:bootstrap-20260711021430",
    );
  });

  void it("keeps Docker context scoped when the Dockerfile only copies service-local paths", () => {
    const repoRoot = "/repo/atlas";
    const plan = resolveDockerBuildPlan({
      projectRoot: repoRoot,
      serviceRoot: "api",
      dockerfileContent: [
        "COPY pyproject.toml uv.lock README.md ./",
        "COPY atlas atlas",
      ].join("\n"),
    });

    assert.deepEqual(plan, {
      contextDir: "/repo/atlas/api",
      dockerfilePath: "/repo/atlas/api/Dockerfile",
      cloudBuildDockerfilePath: "Dockerfile",
    });
  });

  void it("formats Cloud Run env vars as JSON map data", () => {
    const content = formatCloudRunEnvVarsFileContent({
      ATLAS_PUBLIC_URL: "https://atlas.rebuildingus.org",
      CORS_ORIGINS: '["https://atlas.rebuildingus.org"]',
    });

    assert.deepEqual(JSON.parse(content), {
      ATLAS_PUBLIC_URL: "https://atlas.rebuildingus.org",
      CORS_ORIGINS: '["https://atlas.rebuildingus.org"]',
    });
    assert.doesNotMatch(content, /^ATLAS_PUBLIC_URL=/m);
  });

  void it("detects gcloud reauthentication failures from Cloud Build output", () => {
    assert.equal(
      isGcloudReauthenticationFailure({
        ok: false,
        stdout: "",
        stderr:
          "There was a problem refreshing your current auth tokens: Reauthentication failed. cannot prompt during non-interactive execution. Please run: gcloud auth login",
      }),
      true,
    );
  });

  void it("tells the operator how to recover stale gcloud credentials", () => {
    const recovery = formatGcloudReauthenticationRecovery();

    assert.match(recovery, /gcloud auth login/);
    assert.match(recovery, /retry Cloud Build/);
    assert.doesNotMatch(recovery, /cannot prompt during non-interactive/);
  });

  void it("detects Cloud Build source bucket access failures", () => {
    const failure = parseCloudBuildSourceAccessFailure({
      ok: false,
      stdout: "",
      stderr:
        "ERROR: (gcloud.builds.submit) INVALID_ARGUMENT: could not resolve source: googleapi: Error 403: 1039543329255-compute@developer.gserviceaccount.com does not have storage.objects.get access to the Google Cloud Storage object. Permission 'storage.objects.get' denied on resource '//storage.googleapis.com/projects/_/buckets/rap-atlas-prod_cloudbuild/objects/source/1783724432.871416-16c47de283f34c848ce82c4a03592e70.tgz' (or it may not exist).",
    });

    assert.deepEqual(failure, {
      serviceAccount: "1039543329255-compute@developer.gserviceaccount.com",
      bucket: "rap-atlas-prod_cloudbuild",
    });
  });

  void it("shows a narrow Cloud Build source bucket autofix", () => {
    const failure = {
      serviceAccount: "1039543329255-compute@developer.gserviceaccount.com",
      bucket: "rap-atlas-prod_cloudbuild",
    };

    const command = formatCloudBuildSourceAccessGrantCommand(failure);
    assert.match(command, /gcloud storage buckets add-iam-policy-binding/);
    assert.match(command, /gs:\/\/rap-atlas-prod_cloudbuild/);
    assert.match(
      command,
      /serviceAccount:1039543329255-compute@developer\.gserviceaccount\.com/,
    );
    assert.match(command, /roles\/storage\.objectViewer/);

    const note = formatCloudBuildSourceAccessRecoveryNote(failure);
    assert.match(note, /Cloud Build uploaded the source archive/);
    assert.match(note, /rap-atlas-prod_cloudbuild/);
    assert.match(note, /Storage Object Viewer/);
    assert.match(note, /retry the build/);

    const followUp = formatCloudBuildSourceAccessFollowUp(failure);
    assert.match(followUp, /Storage Object Viewer/);
    assert.match(followUp, /pnpm bootstrap --resume/);
  });
});
