import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailDeliveryRejected, createEmailService } from "@/platform/email/server/service";

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
    vi.useRealTimers();
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
  it("passes a stable idempotency key to Resend and returns the accepted provider id", async () => {
    resendEmailsSendMock
      .mockResolvedValueOnce({ data: { id: "provider" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const service = createEmailService({
      emailFrom: "Atlas",
      emailProvider: "resend",
      captureUrl: null,
      resendApiKey: "test-key", // pragma: allowlist secret
    });
    const message = { to: "person@atlas.test", subject: "Invite", text: "Invite" };
    expect(await service.send(message, { idempotencyKey: "waitlist/id" })).toBe("provider");
    expect(resendEmailsSendMock).toHaveBeenCalledWith(expect.objectContaining(message), {
      idempotencyKey: "waitlist/id",
    });
    await expect(service.send(message)).rejects.toThrow("could not be confirmed");
  });
  it("keeps private waitlist links out of capture logs", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createEmailService({
      emailFrom: "Atlas",
      emailProvider: "capture",
      captureUrl: "https://capture.test",
      resendApiKey: null,
    });
    await service.send(
      {
        to: "person@atlas.test",
        subject: "Invite",
        text: "https://atlas.test/waitlist/link?token=private",
      },
      { idempotencyKey: "waitlist/id" },
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it.each([null, 503, 429])(
    "preserves uncertain Resend outcomes for status %s",
    async (statusCode) => {
      resendEmailsSendMock.mockResolvedValue({
        data: null,
        error: { name: "application_error", statusCode, message: "uncertain" },
      });
      const service = createEmailService({
        emailFrom: "Atlas",
        emailProvider: "resend",
        captureUrl: null,
        resendApiKey: "test-key", // pragma: allowlist secret
      });
      const error = await service
        .send({ to: "person@atlas.test", subject: "Invite", text: "Invite" })
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(EmailDeliveryRejected);
    },
  );

  it.each([400, 403, 408, 409])(
    "classifies definitive rejection separately from retryable status %s",
    async (statusCode) => {
      resendEmailsSendMock.mockResolvedValue({
        data: null,
        error: { name: "validation_error", statusCode, message: "rejected" },
      });
      const service = createEmailService({
        emailFrom: "Atlas",
        emailProvider: "resend",
        captureUrl: null,
        resendApiKey: "test-key", // pragma: allowlist secret
      });
      const error = await service
        .send({ to: "person@atlas.test", subject: "Invite", text: "Invite" })
        .catch((error: unknown) => error);
      expect(error instanceof EmailDeliveryRejected).toBe(statusCode === 400 || statusCode === 403);
    },
  );
  it("paces a batch's Resend requests while retaining each idempotency key", async () => {
    vi.useFakeTimers();
    resendEmailsSendMock.mockResolvedValue({ data: { id: "accepted" }, error: null });
    const service = createEmailService({
      emailFrom: "Atlas",
      emailProvider: "resend",
      captureUrl: null,
      resendApiKey: "test-key", // pragma: allowlist secret
    });
    const message = { to: "person@atlas.test", subject: "Invite", text: "Invite" };
    const first = service.send(message, { idempotencyKey: "waitlist/one" });
    const second = service.send(message, { idempotencyKey: "waitlist/two" });
    expect(resendEmailsSendMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([first, second]);
    expect(resendEmailsSendMock).toHaveBeenCalledTimes(2);
  });
});
