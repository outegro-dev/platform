import Link from "next/link";
import { shortId } from "@/lib/format";
import { actorName } from "@/lib/queries";

/**
 * An operator who did something: by name for readers who may see users,
 * by short ID otherwise. Either way it links to the user card. For audit
 * feeds only: each distinct actor is one Identity read per request, which
 * a list of many users (readers, buyers) must not cost; those show short IDs.
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
