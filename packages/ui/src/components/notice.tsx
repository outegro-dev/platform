import { cn } from "@outegro/ui/lib/utils";
import {
  CheckCircleIcon,
  InfoIcon,
  TrayIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { cva } from "class-variance-authority";
import type * as React from "react";

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * "polite" → role=status, "assertive" → role=alert. A live region announces
 * changes: keep it mounted and change its content, or mount it in response
 * to the person's action (assertive). Nothing is announced by default.
 */
type LiveMode = "polite" | "assertive";

const liveRoles = { polite: "status", assertive: "alert" } as const;

/** Text and icon colour of each tone: AA on its soft fill in both tones. */
const inks: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-ok",
  warning: "text-warn",
  danger: "text-danger",
};

const noticeVariants = cva(
  "flex items-start gap-3 rounded-md border p-4 text-sm leading-6 text-foreground sm:px-5",
  {
    variants: {
      tone: {
        neutral: "border-border bg-secondary",
        info: "border-info/25 bg-info-soft",
        success: "border-ok/25 bg-ok-soft",
        warning: "border-warn/30 bg-warn-soft",
        danger: "border-danger/25 bg-danger-soft",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const noticeIcons = {
  neutral: InfoIcon,
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: WarningIcon,
  danger: WarningCircleIcon,
} as const;

type NoticeProps = Omit<React.ComponentProps<"div">, "title"> & {
  tone?: StatusTone;
  /** Short first line in bold; the children become the explanation. */
  title?: React.ReactNode;
  /** Replaces the tone's icon; `null` shows none. Always decorative. */
  icon?: React.ReactNode;
  /** Buttons or links under the text, for example "Try again". */
  actions?: React.ReactNode;
  live?: LiveMode;
};

/** Inline callout: a state, a hint or a result next to the content it is about. */
function Notice({
  tone = "neutral",
  title,
  icon,
  actions,
  live,
  className,
  children,
  ...props
}: NoticeProps) {
  const Icon = noticeIcons[tone];
  const glyph = icon === undefined ? <Icon /> : icon;
  return (
    <div
      data-slot="notice"
      data-tone={tone}
      role={live ? liveRoles[live] : undefined}
      className={cn(noticeVariants({ tone }), className)}
      {...props}
    >
      {glyph ? (
        <span
          aria-hidden="true"
          data-slot="notice-icon"
          className={cn(
            "flex h-6 shrink-0 items-center [&_svg]:size-5",
            inks[tone],
          )}
        >
          {glyph}
        </span>
      ) : null}
      <div className="grid min-w-0 flex-1 gap-1 break-words">
        {title ? (
          <p data-slot="notice-title" className="text-[15px] font-semibold">
            {title}
          </p>
        ) : null}
        {children ? (
          <div
            data-slot="notice-body"
            className={title ? "text-muted-foreground" : undefined}
          >
            {children}
          </div>
        ) : null}
        {actions ? (
          <div
            data-slot="notice-actions"
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const panelIcons = {
  neutral: TrayIcon,
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: WarningIcon,
  danger: WarningCircleIcon,
} as const;

const panelBadges: Record<StatusTone, string> = {
  neutral: "bg-secondary text-foreground",
  info: "bg-info-soft text-info",
  success: "bg-ok-soft text-ok",
  warning: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

const statePanelVariants = cva(
  "flex w-full flex-col items-center justify-center text-center",
  {
    variants: {
      size: {
        sm: "min-h-48 gap-2 px-4 py-8",
        md: "min-h-72 gap-3 px-5 py-10 sm:px-8",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type StatePanelProps = Omit<React.ComponentProps<"section">, "title"> & {
  /** Tints the icon badge; the default icon follows it too. */
  tone?: StatusTone;
  /** What the state is about (empty tray, cloud with a slash…); decorative. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** Level of the title in the page outline (default 2). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** One or two sentences: why, and what happens next. Inline content. */
  description?: React.ReactNode;
  /** The way forward: retry, go back, sign in. */
  actions?: React.ReactNode;
  /** As on Notice. Not with as="main": the role would replace the landmark. */
  live?: LiveMode;
  size?: "sm" | "md";
  /** `main` when the state is the whole page's content (error pages). */
  as?: "section" | "div" | "main";
};

/**
 * Section-level state: empty, error, unavailable, offline. Always a heading,
 * an explanation and a way forward, so a failure never reads as "nothing
 * here". Centred in a reserved minimum height (override with className), so
 * swapping it with content or a skeleton of that height moves nothing.
 */
function StatePanel({
  tone = "neutral",
  icon,
  title,
  headingLevel = 2,
  description,
  actions,
  live,
  size = "md",
  as = "section",
  className,
  children,
  ...props
}: StatePanelProps) {
  // Every option is an HTMLElement with the same attributes; typing it as
  // one of them keeps `ref` (Ref<HTMLElement>) assignable.
  const Root = as as "section";
  const Heading = `h${headingLevel}` as const;
  const Icon = panelIcons[tone];
  const glyph = icon === undefined ? <Icon /> : icon;
  return (
    <Root
      data-slot="state-panel"
      data-tone={tone}
      role={live ? liveRoles[live] : undefined}
      className={cn(statePanelVariants({ size }), className)}
      {...props}
    >
      {glyph ? (
        <span
          aria-hidden="true"
          data-slot="state-panel-icon"
          className={cn(
            "mb-1 grid shrink-0 place-items-center rounded-full",
            size === "sm" ? "size-11 [&_svg]:size-5" : "size-14 [&_svg]:size-7",
            panelBadges[tone],
          )}
        >
          {glyph}
        </span>
      ) : null}
      <Heading
        data-slot="state-panel-title"
        className={cn(
          "max-w-[28ch] font-semibold text-balance text-foreground",
          size === "sm"
            ? "text-lg leading-snug tracking-[-0.02em]"
            : "text-2xl leading-[1.15] tracking-[-0.035em] sm:text-[28px]",
        )}
      >
        {title}
      </Heading>
      {description ? (
        <p
          data-slot="state-panel-description"
          className={cn(
            "max-w-[56ch] text-pretty text-muted-foreground",
            size === "sm" ? "text-sm leading-6" : "text-base leading-relaxed",
          )}
        >
          {description}
        </p>
      ) : null}
      {children}
      {actions ? (
        <div
          data-slot="state-panel-actions"
          className="mt-3 flex flex-wrap items-center justify-center gap-3"
        >
          {actions}
        </div>
      ) : null}
    </Root>
  );
}

export {
  type LiveMode,
  Notice,
  type NoticeProps,
  noticeVariants,
  StatePanel,
  type StatePanelProps,
  type StatusTone,
};
