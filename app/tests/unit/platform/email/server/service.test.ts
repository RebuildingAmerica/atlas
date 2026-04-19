import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthRuntimeConfig } from "@/domains/access/server/runtime";
import { createEmailService } from "@/platform/email/server/service";

const { fetchMock, resendEmailsSendMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  resendEmailsSendMock: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: resendEmailsSendMock,
    };
  },
}));

function buildRuntime(overrides: Partial<AuthRuntimeConfig> = {}): AuthRuntimeConfig {
  return {
    apiAudience: null,
    apiBaseUrl: null,
    apiKeyIntrospectionUrl: "https://atlas.example.com/api/auth/internal/api-key",
    allowedEmails: new Set(),
    localMode: false,
    captureUrl: "http://127.0.0.1:8025/messages",
    dbPath: "/tmp/atlas-auth.sqlite",
    emailFrom: "Atlas <auth@atlas.example.com>",
    emailProvider: "capture",
    internalSecret: "internal-test-secret",
    publicBaseUrl: "https://atlas.example.com",
    publicDomain: "atlas.example.com",
    resendApiKey: null,
    ...overrides,
  };
}

describe("createEmailService", () => {
  afterEach(() => {
    fetchMock.mockReset();
    resendEmailsSendMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("sends mail through capture when capture is configured", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = createEmailService(buildRuntime());

    await service.send({
      subject: "Sign in to Atlas",
      text: "Use this link",
      to: "operator@atlas.test",
    });

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8025/messages", {
      body: JSON.stringify({
        from: "Atlas <auth@atlas.example.com>",
        subject: "Sign in to Atlas",
        text: "Use this link",
        to: "operator@atlas.test",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });

  it("sends mail through resend when resend is configured", async () => {
    resendEmailsSendMock.mockResolvedValue({ data: { id: "email_123" }, error: null });

    const service = createEmailService(
      buildRuntime({
        captureUrl: null,
        emailProvider: "resend",
        resendApiKey: "re_test_123",
      }),
    );

    await service.send({
      subject: "Verify your Atlas email",
      text: "Open this link",
      to: "operator@atlas.test",
    });

    expect(resendEmailsSendMock).toHaveBeenCalledWith({
      from: "Atlas <auth@atlas.example.com>",
      subject: "Verify your Atlas email",
      text: "Open this link",
      to: "operator@atlas.test",
    });
  });
});
