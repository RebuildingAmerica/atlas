import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseRegion,
  formatGcpProjectChoicePromptMessage,
  formatGcpProjectIdPromptMessage,
  formatGcpRegionPromptMessage,
} from "./infra-project.js";

void describe("GCP infrastructure prompt guidance", () => {
  void it("explains how to choose the GCP project", () => {
    const message = formatGcpProjectChoicePromptMessage("production");

    assert.match(message, /Cloud Run,/);
    assert.match(message, /Artifact Registry, Scheduler/);
    assert.match(message, /Choose the active project/);
    assert.match(message, /Bootstrap will set gcloud/);
  });

  void it("labels the project choice prompt with the requested target", () => {
    const prodMessage = formatGcpProjectChoicePromptMessage("production");
    const stagingMessage = formatGcpProjectChoicePromptMessage("staging");

    assert.match(prodMessage, /configures production/);
    assert.match(stagingMessage, /configures staging/);
  });

  void it("explains how to enter an existing GCP project ID", () => {
    const message = formatGcpProjectIdPromptMessage(false, "production");

    assert.match(message, /cloud-resource-manager/);
    assert.match(message, /Project ID column/);
    assert.match(message, /verify it before continuing/);
  });

  void it("explains how bootstrap uses a new GCP project ID", () => {
    const message = formatGcpProjectIdPromptMessage(true, "production");

    assert.match(message, /globally unique/);
    assert.match(message, /Do not reuse the staging project ID/);
    assert.match(message, /create it with gcloud/);
  });

  void it("warns against reusing the prod project ID when creating staging", () => {
    const message = formatGcpProjectIdPromptMessage(true, "staging");

    assert.match(message, /atlas-staging/);
    assert.match(message, /Do not reuse the production project ID/);
  });

  void it("explains the hosted region prompt", () => {
    const message = formatGcpRegionPromptMessage();

    assert.match(message, /Cloud Run and Artifact Registry/);
    assert.match(message, /us-central1/);
    assert.match(message, /GCP_REGION/);
  });

  void it("uses the persisted region without prompting when defaults are assumed", async () => {
    const region = await chooseRegion(false, "us-central1", [], true);

    assert.equal(region, "us-central1");
  });
});
