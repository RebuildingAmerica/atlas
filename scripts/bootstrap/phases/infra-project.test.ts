import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatGcpProjectChoicePromptMessage,
  formatGcpProjectIdPromptMessage,
  formatGcpRegionPromptMessage,
} from "./infra-project.js";

void describe("GCP infrastructure prompt guidance", () => {
  void it("explains how to choose the GCP project", () => {
    const message = formatGcpProjectChoicePromptMessage();

    assert.match(message, /Cloud Run, Artifact Registry, Scheduler/);
    assert.match(message, /Choose the active project/);
    assert.match(message, /Bootstrap will set gcloud/);
  });

  void it("explains how to enter an existing GCP project ID", () => {
    const message = formatGcpProjectIdPromptMessage(false);

    assert.match(message, /cloud-resource-manager/);
    assert.match(message, /Project ID column/);
    assert.match(message, /verify it before continuing/);
  });

  void it("explains how bootstrap uses a new GCP project ID", () => {
    const message = formatGcpProjectIdPromptMessage(true);

    assert.match(message, /globally unique/);
    assert.match(message, /Do not use a personal or throwaway project/);
    assert.match(message, /create it with gcloud/);
  });

  void it("explains the hosted region prompt", () => {
    const message = formatGcpRegionPromptMessage();

    assert.match(message, /Cloud Run and Artifact Registry/);
    assert.match(message, /us-central1/);
    assert.match(message, /GCP_REGION/);
  });
});
