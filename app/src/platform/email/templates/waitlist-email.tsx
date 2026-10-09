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
      body: `Confirm your email to join the ${plan} waitlist. We’ll let you know when you can sign up.`,
      action: "Confirm email",
    };
  if (kind === "invite")
    return {
      subject: `You’re invited to ${plan}`,
      title: `You’re invited to ${plan}`,
      body: `Thanks for waiting. You can now sign up for ${plan}.`,
      action: `Sign up for ${plan}`,
    };
  return {
    subject: "Your Atlas waitlist link",
    title: "Your waitlist request",
    body: `Check your ${plan} waitlist request or update your details.`,
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
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={styles.body}>
        <div style={styles.preview}>{copy.subject}</div>
        <main style={styles.container}>
          <p style={styles.paragraph}>Atlas</p>
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
            This link expires in 7 days. You can request another from the waitlist page.
          </p>
          <hr style={styles.hr} />
          <p style={styles.footer}>If you didn’t ask for this email, you can ignore it.</p>
        </main>
      </body>
    </html>
  );
}
