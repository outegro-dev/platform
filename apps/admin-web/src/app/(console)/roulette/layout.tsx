import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { SectionFrame } from "@/components/ui/section-frame";
import { CLIENT_NAMESPACES } from "@/lib/constants";

/**
 * The roulette's live board and command forms are client components: these
 * pages hand them the section's words and the names of phases and colours,
 * on top of what every page sends. Other sections do not carry them.
 */
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const messages = await getMessages();
  const labels = messages.labels as Record<string, unknown>;
  const client = {
    ...Object.fromEntries(
      Object.entries(messages).filter(([key]) =>
        CLIENT_NAMESPACES.includes(key),
      ),
    ),
    roulette: messages.roulette,
    labels: {
      roulettePhase: labels.roulettePhase,
      rouletteColor: labels.rouletteColor,
    },
  } as typeof messages;
  return (
    <NextIntlClientProvider messages={client}>
      <SectionFrame section="roulette" permission="roulette.read">
        {children}
      </SectionFrame>
    </NextIntlClientProvider>
  );
}
