import type { BookAccess, BookStats } from "@outegro/contracts/edu";
import { isSafeSvg } from "@outegro/edu-engine";
import { Badge } from "@outegro/ui/badge";
import { Progress } from "@outegro/ui/progress";
import {
  CheckCircleIcon,
  EyeIcon,
  LockSimpleIcon,
  SignInIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";

/**
 * A book's cover illustration (sanitized SVG) next to its title. Its own
 * label (role="img") is in the book's language, so the cover says so.
 */
export function BookCover({
  svg,
  lang,
  className,
}: {
  svg: string;
  /** The book's language: the language of the illustration's label. */
  lang: string;
  className?: string;
}) {
  if (!isSafeSvg(svg))
    return (
      <div className={className ? `book-cover ${className}` : "book-cover"} />
    );
  return (
    <div
      className={className ? `book-cover ${className}` : "book-cover"}
      lang={lang}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from the importer's whitelist, checked again by isSafeSvg
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const accessIcons = {
  open: CheckCircleIcon,
  granted: CheckCircleIcon,
  staff: EyeIcon,
  preview: EyeIcon,
  sign_in: SignInIcon,
  locked: LockSimpleIcon,
} as const;

/** What the reader may read of a book, as a mono badge. */
export async function AccessBadge({ access }: { access: BookAccess }) {
  const t = await getTranslations("bookCard");
  const Icon = accessIcons[access];
  return (
    <Badge
      variant={access === "granted" || access === "open" ? "solid" : "outline"}
      className="access-badge"
      data-access={access}
      data-testid="access-badge"
    >
      <Icon aria-hidden="true" weight="bold" />
      <span className="sr-only">{t("accessPrefix")} </span>
      {t(`access.${access}`)}
    </Badge>
  );
}

/**
 * Chapters, exercises and cards; in detail also diagrams, the topics
 * explained from different angles and sandboxes, where there are any.
 */
export async function BookStatsList({
  stats,
  detailed = false,
}: {
  stats: BookStats;
  detailed?: boolean;
}) {
  const t = await getTranslations("bookCard.stats");
  const items: [string, number][] = [
    ["chapters", stats.chapters],
    ["exercises", stats.exercises],
    ["cards", stats.cards],
  ];
  if (detailed && stats.figures) items.push(["figures", stats.figures]);
  if (detailed && stats.explain) items.push(["explain", stats.explain]);
  if (detailed && stats.sandboxes) items.push(["sandboxes", stats.sandboxes]);
  return (
    <ul className="book-stats" aria-label={t("label")}>
      {items.map(([key, count]) => (
        <li key={key}>{t(key, { count })}</li>
      ))}
    </ul>
  );
}

/** The reader's progress in a book: solved exercises and known cards. */
export async function ProgressMeters({
  slug,
  exercisesSolved,
  exercises,
  cardsKnown,
  cards,
}: {
  /** The book, for the ids that tie each bar to its visible label. */
  slug: string;
  exercisesSolved: number;
  exercises: number;
  cardsKnown: number;
  cards: number;
}) {
  const t = await getTranslations("bookCard.progress");
  const rows = [
    {
      key: "exercises",
      label: t("exercises", { solved: exercisesSolved, total: exercises }),
      value: exercisesSolved,
      max: exercises,
    },
    {
      key: "cards",
      label: t("cards", { known: cardsKnown, total: cards }),
      value: cardsKnown,
      max: cards,
    },
  ];
  return (
    <div className="progress-meters" data-testid="book-progress">
      <p className="progress-title">{t("label")}</p>
      {rows.map((row) => {
        const id = `progress-${slug}-${row.key}`;
        return (
          <div key={row.key} className="progress-row">
            <span id={id} className="progress-label">
              {row.label}
            </span>
            <Progress
              aria-labelledby={id}
              value={row.value}
              max={row.max}
              valueText={row.label}
              size="sm"
              className="[--progress-fill:var(--bk)]"
            />
          </div>
        );
      })}
    </div>
  );
}
