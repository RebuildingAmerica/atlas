import * as React from "react";
import * as styles from "./email-styles";
import type { WaitlistLinkKind } from "@/domains/waitlist/contracts";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import type { WaitlistProduct } from "@/domains/waitlist/contracts";

export function waitlistEmailCopy(kind: WaitlistLinkKind, product: WaitlistProduct) {
  const plan = PRODUCT_LABELS[product];
  if (kind === "confirm")
    return {
      subject: "Confirm your Atlas waitlist signup",
      title: "Confirm your email",
      body: `Join the waitlist for ${plan}. Joining costs nothing.`,
      action: "Confirm email",
    };
  if (kind === "invite")
    return {
      subject: `You can now sign up for ${plan}`,
      title: `${plan} is available to you`,
      body: "Choose a billing interval and finish signup. Payment is required for paid access. Public Atlas remains free.",
      action: "Continue signup",
    };
  return {
    subject: "Your Atlas waitlist link",
    title: "Your waitlist request",
    body: `View or update your request for ${plan}.`,
    action: "View request",
  };
}
export function WaitlistEmail({
  kind,
  product,
  url,
}: {
  kind: WaitlistLinkKind;
  product: WaitlistProduct;
  url: string;
}) {
  const copy = waitlistEmailCopy(kind, product);
  return (
    <html>
      <head />
      <body style={styles.body}>
        <main style={styles.container}>
          <h1 style={styles.heading}>{copy.title}</h1>
          <p style={styles.paragraph}>{copy.body}</p>
          <div style={styles.buttonSection}>
            <a href={url} style={styles.button}>
              {copy.action}
            </a>
          </div>
          <p style={styles.fallback}>
            Or copy this link:{" "}
            <a href={url} style={styles.link}>
              {url}
            </a>
          </p>
          <p style={styles.paragraph}>
            This email link is valid for seven days. You can request a fresh link at any time.
          </p>
          <hr style={styles.hr} />
          <p style={styles.footer}>If you did not request this email, you can ignore it.</p>
        </main>
      </body>
    </html>
  );
}
