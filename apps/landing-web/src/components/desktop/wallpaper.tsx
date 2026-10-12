import Image from "next/image";
import photo from "@/assets/desktop/wallpaper.webp";

/**
 * The desktop's wallpaper: a green hill under a blue sky with clouds, a
 * photograph by Se. Tsuchiya on Unsplash (Unsplash License, free for
 * commercial use, credit not required):
 * https://unsplash.com/photos/SVVKbAy5CDc. Covers the desktop, the hill
 * kept in view.
 */
export function Wallpaper() {
  return (
    <Image
      className="desktop-wallpaper"
      src={photo}
      alt=""
      fill
      sizes="100vw"
      quality={75}
      placeholder="empty"
    />
  );
}
