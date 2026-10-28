import { GrumbleIcon } from "@outegro/ui/grumble-icon";
import { getLocale } from "next-intl/server";

/** Grumbles are whole numbers carried as strings; BigInt keeps every digit. */
export function formatGrumbles(
  amount: string,
  locale: string,
  signed = false,
): string {
  return new Intl.NumberFormat(locale, {
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(BigInt(amount));
}

/** An amount of grumbles with the coin: `signed` for journal amounts. */
export async function Grumbles({
  amount,
  signed = false,
  size = "sm",
}: {
  amount: string;
  signed?: boolean;
  size?: "sm" | "lg";
}) {
  const locale = await getLocale();
  return (
    <span className="num nowrap inline-flex items-center gap-1.5">
      <GrumbleIcon className={size === "lg" ? "size-6" : "size-4"} />
      {formatGrumbles(amount, locale, signed)}
    </span>
  );
}
