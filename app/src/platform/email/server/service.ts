import "@tanstack/react-start/server-only";

import { Resend } from "resend";

export interface EmailMessage {
  subject: string;
  text: string;
  to: string;
}

export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}

class CaptureEmailService implements EmailService {
  constructor(
    private readonly from: string,
    private readonly captureUrl: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
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
      throw new Error(
        `Capture email delivery failed with ${response.status}: ${await response.text()}`,
      );
    }
  }
}

class ResendEmailService implements EmailService {
  private readonly client: Resend;

  constructor(
    private readonly from: string,
    apiKey: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.client.emails.send({
      from: this.from,
      subject: message.subject,
      text: message.text,
      to: message.to,
    });

    if (response.error) {
      throw new Error(response.error.message);
    }
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
