import { describe, expect, it, vi } from "vitest";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { runOrganizationPageMutation } from "@/domains/access/components/organization/organization-page-mutation-helpers";

describe("runOrganizationPageMutation", () => {
  const feedback = {
    setErrorMessage: vi.fn(),
    setFlashMessage: vi.fn(),
  };
  const refreshWorkspaceData = vi.fn().mockResolvedValue(undefined);

  it("handles successful mutations", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const result = await runOrganizationPageMutation({
      action,
      fallbackMessage: "fail",
      feedback,
      refreshWorkspaceData,
      successMessage: "pass",
    });

    expect(result).toEqual({ ok: true });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("pass");
    expect(refreshWorkspaceData).toHaveBeenCalled();
  });

  it("shows a message written for the workspace admin", async () => {
    const action = vi.fn().mockRejectedValue(new UserFacingError("specific error"));
    const result = await runOrganizationPageMutation({
      action,
      fallbackMessage: "fail",
      feedback,
      refreshWorkspaceData,
      successMessage: "pass",
    });

    expect(result).toBeNull();
    expect(feedback.setErrorMessage).toHaveBeenCalledWith("specific error");
  });

  it("hides an internal error's message behind the fallback", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Auth database unavailable"));
    await runOrganizationPageMutation({
      action,
      fallbackMessage: "fail",
      feedback,
      refreshWorkspaceData,
      successMessage: "pass",
    });

    expect(feedback.setErrorMessage).toHaveBeenLastCalledWith("fail");
  });

  it("handles non-Error failures with fallback message", async () => {
    const action = vi.fn().mockRejectedValue("not an error instance");
    const result = await runOrganizationPageMutation({
      action,
      fallbackMessage: "fail",
      feedback,
      refreshWorkspaceData,
      successMessage: "pass",
    });

    expect(result).toBeNull();
    expect(feedback.setErrorMessage).toHaveBeenCalledWith("fail");
  });
});
