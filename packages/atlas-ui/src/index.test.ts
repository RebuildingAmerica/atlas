import { describe, expect, it } from "vitest";
import { AuthFlowFrame, Button, PageLayout, WorkspaceFrame, typographyScale } from ".";

describe("atlas UI public API", () => {
  it("exports reusable controls, layout, and styling", () => {
    expect(Button).toBeTypeOf("function");
    expect(PageLayout).toBeTypeOf("function");
    expect(AuthFlowFrame).toBeTypeOf("function");
    expect(WorkspaceFrame).toBeTypeOf("function");
    expect(typographyScale.bodyMedium.className).toBe("type-body-medium");
  });
});
