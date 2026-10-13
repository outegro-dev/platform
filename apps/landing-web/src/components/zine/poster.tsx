import Image from "next/image";
import cover from "@/assets/zine/cover.webp";

/**
 * The magazine's cover, flat: the front of the book that lifts off the
 * magazine lying on the first screen and opens into the contents. The
 * picture is that magazine's own cover, straightened, print and all, so it
 * says nothing a reader would miss. Only a flight shows it, as large as
 * the magazine's cover where it lifts off; the spreads lying open leave it
 * out, so it waits lazily until IssueFlight asks for it.
 */
export function Poster({ className }: { className?: string }) {
  return (
    <figure className={`poster ${className ?? ""}`} aria-hidden="true">
      <Image
        src={cover}
        alt=""
        sizes="44vw"
        loading="lazy"
        placeholder="empty"
      />
    </figure>
  );
}
