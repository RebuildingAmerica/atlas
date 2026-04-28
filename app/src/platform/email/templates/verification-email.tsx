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

interface VerificationEmailProps {
  url: string;
}

export function VerificationEmail({ url }: VerificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Verify your email address for Atlas</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>Verify your email</Heading>
          <Text style={styles.paragraph}>
            Click the button below to verify your email address and complete your Atlas account
            setup.
          </Text>
          <Section style={styles.buttonSection}>
            <Button href={url} style={styles.button}>
              Verify email address
            </Button>
          </Section>
          <Text style={styles.fallback}>
            Or copy and paste this URL into your browser:{" "}
            <Link href={url} style={styles.link}>
              {url}
            </Link>
          </Text>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            If you didn&rsquo;t create an Atlas account, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
