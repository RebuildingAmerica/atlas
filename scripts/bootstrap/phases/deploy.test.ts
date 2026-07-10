import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyDockerPreflight,
  formatDockerBuildFallbackPrompt,
  formatDockerDaemonRecovery,
  formatDockerStartPrompt,
  formatCloudBuildSourceAccessFollowUp,
  formatCloudBuildSourceAccessGrantCommand,
  formatCloudBuildSourceAccessRecoveryNote,
  formatGcloudReauthenticationRecovery,
  isGcloudReauthenticationFailure,
  parseCloudBuildSourceAccessFailure,
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
