import { cn } from "@outegro/ui/lib/utils";
import { Skeleton } from "@outegro/ui/skeleton";
import { useTranslations } from "next-intl";

/**
 * Pieces for the account loading states. Each mirrors the geometry of what
 * it stands for (line height, control height), so the page does not move
 * when the data replaces it.
 */

/** Announces the loading state; the skeleton itself is hidden from assistive technology. */
export function LoadingNote() {
  const t = useTranslations("status");
  return <p className="sr-only">{t("loading")}</p>;
}

/** A placeholder inside a line of text: the line keeps its own height. */
export function SkeletonText({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn("inline-block h-[0.9em] align-middle", className)}
    />
  );
}

/** Same box as a field label (Label: 14 px, 20 px line). */
export function SkeletonLabel({ children }: { children: string }) {
  return <p className="text-sm leading-5 font-medium">{children}</p>;
}

export { Skeleton };
