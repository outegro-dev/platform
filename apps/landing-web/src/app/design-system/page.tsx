import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { Surface } from "@outegro/ui/surface";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContactDialog } from "@/components/contact-dialog";
import { ContactLinks } from "@/components/contact-links";
import { LocaleSwitcher } from "@/components/locale-switcher";

export const metadata: Metadata = {
  title: "Material library — Nick Lukashik",
  robots: { index: false, follow: false },
};

export default async function Gallery() {
  const t = await getTranslations("gallery");
  return (
    <main className="gallery og-container">
      <div className="gallery-top">
        <a href="/" className="gallery-back">
          {t("back")} <ArrowUpRightIcon />
        </a>
        <LocaleSwitcher />
      </div>
      <h1>
        {t("title").split(" ").slice(0, -1).join(" ")}{" "}
        <span className="og-accent">{t("title").split(" ").at(-1)}</span>
      </h1>
      <p>{t("intro")}</p>

      <section>
        <h2 className="og-eyebrow">{t("type")}</h2>
        <p className="gallery-display">
          Aa <span className="og-accent">Aa</span>
        </p>
        <p className="og-eyebrow">
          Manrope · Cormorant Garamond Italic · JetBrains Mono
        </p>
      </section>

      <section>
        <h2 className="og-eyebrow">{t("buttons")}</h2>
        <div className="gallery-row">
          <Button asChild size="lg">
            <a href="#surfaces">{t("primary")}</a>
          </Button>
          <Button variant="secondary" size="lg">
            {t("secondary")}
          </Button>
          <Button variant="outline" size="lg">
            {t("outline")}
          </Button>
          <Button variant="glass" size="lg">
            {t("glassAction")}
          </Button>
          <Button size="lg" disabled>
            {t("disabled")}
          </Button>
          <ContactDialog variant="primary" compact>
            <ContactLinks compact />
          </ContactDialog>
        </div>
      </section>

      <section>
        <h2 className="og-eyebrow">{t("badges")}</h2>
        <div className="gallery-row">
          <Badge>TypeScript</Badge>
          <Badge variant="solid">NestJS 12</Badge>
          <Badge variant="muted">K3s</Badge>
          <Badge variant="glass">Beta</Badge>
        </div>
      </section>

      <section id="surfaces">
        <h2 className="og-eyebrow">{t("surfaces")}</h2>
        <div className="gallery-surfaces">
          <Surface variant="glass">{t("glass")}</Surface>
          <Surface>{t("solid")}</Surface>
          <Surface variant="inverse">{t("inverse")}</Surface>
        </div>
      </section>

      <section id="field">
        <Label htmlFor="demo-email">{t("input")}</Label>
        <Input
          id="demo-email"
          name="demo-email"
          type="email"
          spellCheck={false}
          autoComplete="email"
          aria-describedby="email-help"
        />
        <p id="email-help">{t("inputHelp")}</p>
      </section>

      <section>
        <h2 className="og-eyebrow">{t("states")}</h2>
        <p className="text-destructive">{t("error")}</p>
        <p className="text-success">{t("success")}</p>
      </section>
    </main>
  );
}
