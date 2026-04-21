import { describe, expect, it, vi } from "vitest";
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

  it("handles Error instances", async () => {
    const action = vi.fn().mockRejectedValue(new Error("specific error"));
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
