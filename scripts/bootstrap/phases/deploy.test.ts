import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyDockerPreflight,
  formatDockerDaemonRecovery,
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
});
