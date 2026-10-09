import "@tanstack/react-start/server-only";

import { Resend } from "resend";

export interface EmailMessage {
  html?: string;
  subject: string;
  text: string;
  to: string;
}

export interface EmailSendOptions {
  idempotencyKey: string;
}

export class EmailDeliveryRejected extends Error {}

export interface EmailService {
  send(message: EmailMessage, options?: EmailSendOptions): Promise<string | undefined>;
}

class CaptureEmailService implements EmailService {
  constructor(
    private readonly from: string,
    private readonly captureUrl: string,
  ) {}

  async send(message: EmailMessage, options?: EmailSendOptions): Promise<undefined> {
    const response = await fetch(this.captureUrl, {
      body: JSON.stringify({
        from: this.from,
        subject: message.subject,
        text: message.text,
        to: message.to,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(
        `[atlas/email] capture delivery failed — status=${response.status} body=${body}`,
      );
      throw new EmailDeliveryRejected("Email delivery failed.");
    }

    const link = /https?:\/\/\S+/.exec(message.text)?.[0];
    if (link && !options?.idempotencyKey.startsWith("waitlist/")) {
      console.warn(`\n[atlas/email] ✉  ${message.to}\n[atlas/email] →  ${link}\n`);
    }
  }
}

class ResendEmailService implements EmailService {
  private readonly client: Resend;
  private nextWaitlistSendAt = 0;

  constructor(
    private readonly from: string,
    apiKey: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage, options?: EmailSendOptions): Promise<string | undefined> {
    if (options?.idempotencyKey.startsWith("waitlist/")) {
      const delay = Math.max(0, this.nextWaitlistSendAt - Date.now());
      this.nextWaitlistSendAt = Date.now() + delay + 600;
      if (delay > 0)
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delay);
        });
    }
    const payload = {
      from: this.from,
      html: message.html,
      subject: message.subject,
      text: message.text,
      to: message.to,
    };
    const response = options
      ? await this.client.emails.send(payload, options)
      : await this.client.emails.send(payload);

    if (response.error) {
      console.error(`[atlas/email] resend delivery failed — ${response.error.message}`);
      const code = response.error.statusCode;
      if (
        typeof code === "number" &&
        code >= 400 &&
        code < 500 &&
        code !== 408 &&
        code !== 409 &&
        code !== 429
      )
        throw new EmailDeliveryRejected("Email delivery failed.");
      throw new Error("Email delivery failed.");
    }
    if (!response.data?.id) throw new Error("Email delivery could not be confirmed.");
    return response.data.id;
  }
}

export interface EmailConfig {
  emailProvider: "capture" | "resend";
  emailFrom: string;
  captureUrl: string | null;
  resendApiKey: string | null;
}

export function createEmailService(config: EmailConfig): EmailService {
  if (config.emailProvider === "resend") {
    if (!config.resendApiKey) {
      throw new Error("ATLAS_EMAIL_RESEND_API_KEY is required when ATLAS_EMAIL_PROVIDER=resend.");
    }

    return new ResendEmailService(config.emailFrom, config.resendApiKey);
  }

  if (!config.captureUrl) {
    throw new Error("ATLAS_EMAIL_CAPTURE_URL is required when ATLAS_EMAIL_PROVIDER=capture.");
  }

  return new CaptureEmailService(config.emailFrom, config.captureUrl);
}
