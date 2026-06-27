import * as React from "react";
import * as styles from "./email-styles";

interface VerificationEmailProps {
  url: string;
}

export function VerificationEmail({ url }: VerificationEmailProps) {
  return (
    <html>
      <head />
      <body style={styles.body}>
        <div style={styles.preview}>Verify your email address for Atlas</div>
        <main style={styles.container}>
          <h1 style={styles.heading}>Verify your email</h1>
          <p style={styles.paragraph}>
            Click the button below to verify your email address and complete your Atlas account
            setup.
          </p>
          <div style={styles.buttonSection}>
            <a href={url} style={styles.button}>
              Verify email address
            </a>
          </div>
          <p style={styles.fallback}>
            Or copy and paste this URL into your browser:{" "}
            <a href={url} style={styles.link}>
              {url}
            </a>
          </p>
          <hr style={styles.hr} />
          <p style={styles.footer}>
            If you didn&rsquo;t create an Atlas account, you can safely ignore this email.
          </p>
        </main>
      </body>
    </html>
  );
}
