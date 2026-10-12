import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { calendly, contacts } from "@/lib/contact";
import { EmailAddress, EmailLink } from "./email-link";

/**
 * Every way to reach me, the booked call first: it is the main action.
 * `part` splits the list where a page lays it out in two places: the call
 * alone, or every other way to write.
 */
export function ContactLinks({
  compact = false,
  part = "all",
}: {
  compact?: boolean;
  part?: "all" | "call" | "rest";
}) {
  const t = useTranslations();
  return (
    <ul className={`contact-links${compact ? " is-compact" : ""}`}>
      {part !== "rest" && (
        <li className="is-call">
          <a href={calendly} target="_blank" rel="noopener noreferrer">
            <span className="og-eyebrow">{t("contact.calendly")}</span>
            <span className="contact-handle">{t("nav.book")}</span>
            <ArrowUpRightIcon className="contact-arrow" aria-hidden="true" />
          </a>
        </li>
      )}
      {part !== "call" && (
        <>
          <li>
            <EmailLink>
              <span className="og-eyebrow">{t("contact.email")}</span>
              <EmailAddress className="contact-handle" />
              <ArrowUpRightIcon className="contact-arrow" aria-hidden="true" />
            </EmailLink>
          </li>
          {contacts.map((contact) => (
            <li key={contact.key}>
              <a href={contact.href} target="_blank" rel="noopener noreferrer">
                <span className="og-eyebrow">
                  {t(`contact.${contact.key}`)}
                </span>
                <span className="contact-handle">{contact.handle}</span>
                <ArrowUpRightIcon
                  className="contact-arrow"
                  aria-hidden="true"
                />
              </a>
            </li>
          ))}
        </>
      )}
    </ul>
  );
}
