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
