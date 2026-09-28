import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { contacts } from "@/lib/contact";

export function ContactLinks({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("contact");
  return (
    <ul className={`contact-links${compact ? " is-compact" : ""}`}>
      {contacts.map((contact) => (
        <li key={contact.key}>
          <a
            href={contact.href}
            target={contact.key === "email" ? undefined : "_blank"}
            rel={contact.key === "email" ? undefined : "noopener noreferrer"}
          >
            <span className="og-eyebrow">{t(contact.key)}</span>
            <span className="contact-handle">{contact.handle}</span>
            <ArrowUpRightIcon className="contact-arrow" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
