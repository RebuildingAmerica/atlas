import * as React from "react";
import * as styles from "./email-styles";

interface InvitationEmailProps {
  organizationName: string;
  signInUrl: string;
}

export function InvitationEmail({ organizationName, signInUrl }: InvitationEmailProps) {
  return (
    <html>
      <head />
      <body style={styles.body}>
        <div style={styles.preview}>
          You&rsquo;ve been invited to join {organizationName} on Atlas
        </div>
        <main style={styles.container}>
          <h1 style={styles.heading}>You&rsquo;ve been invited</h1>
          <p style={styles.paragraph}>
            You&rsquo;ve been invited to join <strong>{organizationName}</strong> on Atlas. Sign in
            to review and accept the invitation.
          </p>
          <div style={styles.buttonSection}>
            <a href={signInUrl} style={styles.button}>
              Accept invitation
            </a>
          </div>
          <p style={styles.fallback}>
            Or copy and paste this URL into your browser:{" "}
            <a href={signInUrl} style={styles.link}>
              {signInUrl}
            </a>
          </p>
          <hr style={styles.hr} />
          <p style={styles.footer}>
            If you weren&rsquo;t expecting this invitation, you can safely ignore this email.
          </p>
        </main>
      </body>
    </html>
  );
}
