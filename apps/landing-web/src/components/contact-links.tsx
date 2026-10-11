import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { calendly, contacts } from "@/lib/contact";

/** Every way to reach me, the booked call first: it is the main action. */
export function ContactLinks({ compact = false }: { compact?: boolean }) {
  const t = useTranslations();
  return (
    <ul className={`contact-links${compact ? " is-compact" : ""}`}>
      <li className="is-call">
        <a href={calendly} target="_blank" rel="noopener noreferrer">
          <span className="og-eyebrow">{t("contact.calendly")}</span>
          <span className="contact-handle">{t("nav.book")}</span>
          <ArrowUpRightIcon className="contact-arrow" aria-hidden="true" />
        </a>
      </li>
      {contacts.map((contact) => (
        <li key={contact.key}>
          <a
            href={contact.href}
            target={contact.key === "email" ? undefined : "_blank"}
            rel={contact.key === "email" ? undefined : "noopener noreferrer"}
          >
            <span className="og-eyebrow">{t(`contact.${contact.key}`)}</span>
            <span className="contact-handle">{contact.handle}</span>
            <ArrowUpRightIcon className="contact-arrow" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
