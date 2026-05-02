import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("EmailService", () => {
  afterEach(() => {
    fetchMock.mockReset();
    resendEmailsSendMock.mockReset();
    vi.unstubAllGlobals();
  });

  describe("CaptureEmailService", () => {
    it("delivers email via fetch to the capture URL", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
      });
      vi.stubGlobal("fetch", fetchMock);

      const service = createEmailService({
        emailFrom: "Atlas <auth@atlas.test>",
        emailProvider: "capture",
        captureUrl: "http://localhost:8025/messages",
        resendApiKey: null,
      });

      await service.send({
        subject: "Test",
        text: "Hello",
        to: "user@atlas.test",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8025/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            from: "Atlas <auth@atlas.test>",
            subject: "Test",
            text: "Hello",
            to: "user@atlas.test",
          }),
        }),
      );
    });

    it("logs the captured magic-link when the email body contains a URL", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
        // Suppress capture-mode magic-link debug logs.
      });

      const service = createEmailService({
        emailFrom: "Atlas <auth@atlas.test>",
        emailProvider: "capture",
        captureUrl: "http://localhost:8025/messages",
        resendApiKey: null,
      });

      await service.send({
        subject: "Sign in",
        text: "Click https://atlas.example/auth/magic-link?token=abc to continue.",
        to: "user@atlas.test",
      });

      expect(warnSpy).toHaveBeenCalled();
      const logged = warnSpy.mock.calls.flat().join("\n");
      expect(logged).toContain("https://atlas.example/auth/magic-link");
      warnSpy.mockRestore();
    });
  });

  describe("ResendEmailService", () => {
    it("delivers email via Resend client", async () => {
      resendEmailsSendMock.mockResolvedValue({
        data: { id: "msg_123" },
        error: null,
      });

      const service = createEmailService({
        emailFrom: "Atlas <auth@atlas.test>",
        emailProvider: "resend",
        captureUrl: null,
        resendApiKey: "re_test_123",
      });

      await service.send({
        subject: "Test",
        text: "Hello",
        to: "user@atlas.test",
      });

      expect(resendEmailsSendMock).toHaveBeenCalledWith({
        from: "Atlas <auth@atlas.test>",
        subject: "Test",
        text: "Hello",
        to: "user@atlas.test",
      });
    });
  });
});
