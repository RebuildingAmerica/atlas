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
    databaseUrl: null,
    localMode: false,
    openRegistration: true,
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

describe("email service error branches", () => {
  afterEach(() => {
    fetchMock.mockReset();
    resendEmailsSendMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("throws when capture delivery fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue("capture offline"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = createEmailService(buildRuntime());

    await expect(
      service.send({
        subject: "Sign in to Atlas",
        text: "Use this link",
        to: "operator@atlas.test",
      }),
    ).rejects.toThrow("Capture email delivery failed with 502: capture offline");
  });

  it("throws when Resend reports an error", async () => {
    resendEmailsSendMock.mockResolvedValue({
      data: null,
      error: {
        message: "resend offline",
      },
    });

    const service = createEmailService(
      buildRuntime({
        captureUrl: null,
        emailProvider: "resend",
        resendApiKey: "re_test_123",
      }),
    );

    await expect(
      service.send({
        subject: "Verify your Atlas email",
        text: "Open this link",
        to: "operator@atlas.test",
      }),
    ).rejects.toThrow("resend offline");
  });

  it("requires resend and capture configuration before building a sender", () => {
    expect(() =>
      createEmailService(
        buildRuntime({
          captureUrl: null,
          emailProvider: "resend",
          resendApiKey: null,
        }),
      ),
    ).toThrow("ATLAS_EMAIL_RESEND_API_KEY is required when ATLAS_EMAIL_PROVIDER=resend.");

    expect(() =>
      createEmailService(
        buildRuntime({
          captureUrl: null,
          emailProvider: "capture",
        }),
      ),
    ).toThrow("ATLAS_EMAIL_CAPTURE_URL is required when ATLAS_EMAIL_PROVIDER=capture.");
  });
});
