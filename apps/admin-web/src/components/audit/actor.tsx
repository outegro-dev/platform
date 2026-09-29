import Link from "next/link";
import { shortId } from "@/lib/format";
import { actorName } from "@/lib/queries";

/**
 * An operator who did something: by name for readers who may see users,
 * by short ID otherwise. Either way it links to the user card.
 */
export async function Actor({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const name = await actorName(id);
  return (
    <Link
      href={`/users/${encodeURIComponent(id)}`}
      className={[name ? "link" : "link mono", className]
        .filter(Boolean)
        .join(" ")}
    >
      {name ?? shortId(id)}
    </Link>
  );
}
