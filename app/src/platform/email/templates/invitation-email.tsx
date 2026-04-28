import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import * as styles from "./email-styles";

interface InvitationEmailProps {
  organizationName: string;
  signInUrl: string;
}

export function InvitationEmail({ organizationName, signInUrl }: InvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>You&rsquo;ve been invited to join {organizationName} on Atlas</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>You&rsquo;ve been invited</Heading>
          <Text style={styles.paragraph}>
            You&rsquo;ve been invited to join <strong>{organizationName}</strong> on Atlas. Sign in
            to review and accept the invitation.
          </Text>
          <Section style={styles.buttonSection}>
            <Button href={signInUrl} style={styles.button}>
              Accept invitation
            </Button>
          </Section>
          <Text style={styles.fallback}>
            Or copy and paste this URL into your browser:{" "}
            <Link href={signInUrl} style={styles.link}>
              {signInUrl}
            </Link>
          </Text>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            If you weren&rsquo;t expecting this invitation, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
