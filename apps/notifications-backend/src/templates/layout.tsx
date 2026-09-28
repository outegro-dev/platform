import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

const colors = {
  canvas: "#f2f2ef",
  surface: "#fafaf7",
  ink: "#171817",
  muted: "#5b5d58",
  line: "#c7c9c2",
};
const sans = "Manrope, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const settingsLabel = {
  en: "Notification settings",
  ru: "Настройки уведомлений",
};

/** Brand frame for every email: gallery canvas, wordmark, quiet footer. */
export function Layout(props: {
  locale: "en" | "ru";
  preview: string;
  footer: string;
  webUrl: string;
  /** Where the reader can change channels; omitted for sign-in codes. */
  settingsUrl?: string;
  children: ReactNode;
}) {
  return (
    <Html lang={props.locale}>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: colors.canvas,
          fontFamily: sans,
          color: colors.ink,
        }}
      >
        <Container
          style={{ maxWidth: 520, margin: "0 auto", padding: "40px 20px" }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              margin: "0 0 28px",
            }}
          >
            Nick Lukashik
          </Text>
          <Section
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.line}`,
              borderRadius: 20,
              padding: "32px 28px",
            }}
          >
            {props.children}
          </Section>
          <Hr style={{ borderColor: colors.line, margin: "28px 0 16px" }} />
          <Text
            style={{
              fontSize: 12,
              lineHeight: "18px",
              color: colors.muted,
              margin: 0,
            }}
          >
            {props.footer}{" "}
            <Link href={props.webUrl} style={{ color: colors.muted }}>
              outegro.dev
            </Link>
            {props.settingsUrl && (
              <>
                {" · "}
                <Link href={props.settingsUrl} style={{ color: colors.muted }}>
                  {settingsLabel[props.locale]}
                </Link>
              </>
            )}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const Title = ({ children }: { children: ReactNode }) => (
  <Text
    style={{
      fontSize: 24,
      lineHeight: "30px",
      fontWeight: 700,
      letterSpacing: "-0.03em",
      margin: "0 0 12px",
    }}
  >
    {children}
  </Text>
);

export const Paragraph = ({ children }: { children: ReactNode }) => (
  <Text
    style={{
      fontSize: 15,
      lineHeight: "24px",
      color: colors.muted,
      margin: "0 0 16px",
    }}
  >
    {children}
  </Text>
);

/** Large, copy-friendly one-time code. */
export const Code = ({ value }: { value: string }) => (
  <Text
    style={{
      fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
      fontSize: 34,
      letterSpacing: "0.3em",
      fontWeight: 600,
      margin: "20px 0",
      color: colors.ink,
    }}
  >
    {value}
  </Text>
);

/** The one next step of an email, as a button that also survives plain text. */
export const Action = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => (
  <Button
    href={href}
    style={{
      display: "inline-block",
      backgroundColor: colors.ink,
      color: colors.surface,
      borderRadius: 999,
      padding: "14px 24px",
      fontSize: 14,
      fontWeight: 600,
      textDecoration: "none",
      marginTop: 8,
    }}
  >
    {children}
  </Button>
);
