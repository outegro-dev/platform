import Image from "next/image";
import cover from "@/assets/zine/cover.webp";

/**
 * The magazine's cover, flat: the front of the book that lifts off the
 * magazine lying on the first screen and opens into the contents. The
 * picture is that magazine's own cover, straightened, print and all, so it
 * says nothing a reader would miss.
 */
export function Poster({ className }: { className?: string }) {
  return (
    <figure className={`poster ${className ?? ""}`} aria-hidden="true">
      <Image
        src={cover}
        alt=""
        sizes="(max-width: 767px) 92vw, 44vw"
        loading="eager"
        quality={78}
        placeholder="empty"
      />
    </figure>
  );
}
