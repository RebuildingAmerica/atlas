import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyDockerPreflight,
  formatDockerBuildFallbackPrompt,
  formatDockerDaemonRecovery,
  formatDockerStartPrompt,
  formatGcloudReauthenticationRecovery,
  isGcloudReauthenticationFailure,
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
});
