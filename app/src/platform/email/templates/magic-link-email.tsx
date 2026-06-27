import * as React from "react";
import * as styles from "./email-styles";

interface MagicLinkEmailProps {
  url: string;
}

export function MagicLinkEmail({ url }: MagicLinkEmailProps) {
  return (
    <html>
      <head />
      <body style={styles.body}>
        <div style={styles.preview}>Your sign-in link for Atlas</div>
        <main style={styles.container}>
          <h1 style={styles.heading}>Sign in to Atlas</h1>
          <p style={styles.paragraph}>
            Click the button below to sign in. This link expires in 5 minutes.
          </p>
          <div style={styles.buttonSection}>
            <a href={url} style={styles.button}>
              Sign in to Atlas
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
            If you didn&rsquo;t request this link, you can safely ignore this email.
          </p>
        </main>
      </body>
    </html>
  );
}
