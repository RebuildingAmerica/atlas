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

interface MagicLinkEmailProps {
  url: string;
}

export function MagicLinkEmail({ url }: MagicLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your sign-in link for Atlas</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>Sign in to Atlas</Heading>
          <Text style={styles.paragraph}>
            Click the button below to sign in. This link expires in 5 minutes.
          </Text>
          <Section style={styles.buttonSection}>
            <Button href={url} style={styles.button}>
              Sign in to Atlas
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
            If you didn&rsquo;t request this link, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
