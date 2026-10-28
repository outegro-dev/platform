/**
 * The voice file of Work Finder (08_VOICE_ABOUT_ME_AND_MESSAGES.md): the
 * numbered style rules, the Telegram template and the about-me sample.
 * Sections are found by their headings, the samples are fenced blocks.
 */
export type Voice = {
  rules: string[];
  telegramTemplateRu: string | null;
  aboutMe: string | null;
};

type Section = { heading: string; body: string };

function sections(markdown: string): Section[] {
  const parts = markdown
    .replace(/\r\n?/g, "\n")
    .split(/^##\s+/m)
    .slice(1);
  return parts.map((part) => {
    const [heading = "", ...rest] = part.split("\n");
    return { heading: heading.trim(), body: rest.join("\n") };
  });
}

const fenced = (body: string) =>
  [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) =>
    (match[1] ?? "").trim(),
  );

const clip = (value: string, max: number) =>
  value.length <= max ? value : value.slice(0, max).trimEnd();

/** Markdown emphasis and code marks off; the words stay. */
const unmark = (value: string) =>
  value
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export function parseVoice(markdown: string): Voice {
  const all = sections(markdown);
  const rulesSection = all.find((section) =>
    /правил|rules/i.test(section.heading),
  );
  const rules = rulesSection
    ? [...rulesSection.body.matchAll(/^\s*\d+\.\s+(.+)$/gm)]
        .map((match) => clip(unmark(match[1] ?? ""), 500))
        .filter(Boolean)
        .slice(0, 60)
    : [];
  const telegram = all.find((section) => /telegram/i.test(section.heading));
  const about = all.find((section) => /about me/i.test(section.heading));
  const aboutBlock = about
    ? (() => {
        // The sample right after a line that names it, else the first block.
        const marker = about.body.search(/about me/i);
        return (
          fenced(marker >= 0 ? about.body.slice(marker) : about.body)[0] ??
          fenced(about.body)[0]
        );
      })()
    : undefined;
  const telegramBlock = telegram ? fenced(telegram.body)[0] : undefined;
  return {
    rules,
    telegramTemplateRu: telegramBlock ? clip(telegramBlock, 2000) : null,
    aboutMe: aboutBlock ? clip(aboutBlock, 4000) : null,
  };
}
