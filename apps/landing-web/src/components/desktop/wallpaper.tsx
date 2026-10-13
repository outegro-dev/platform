import Image from "next/image";
import photo from "@/assets/desktop/wallpaper.webp";
import { WhenNear } from "@/components/when-near";

/**
 * The desktop's wallpaper: a green hill under a blue sky with clouds, a
 * photograph by Se. Tsuchiya on Unsplash (Unsplash License, free for
 * commercial use, credit not required):
 * https://unsplash.com/photos/SVVKbAy5CDc. Covers the desktop, the hill
 * kept in view.
 *
 * The heaviest picture of the page, far down it: it mounts once the
 * desktop is a screen away (not two: on a laptop the first layout has it
 * under three screens down).
 */
export function Wallpaper() {
  // its own box over the backdrop: a filled picture measures a positioned
  // parent, and the backdrop is sticky. The backdrop is a screen high, so
  // on a screen narrower than the picture's 3:2 it is drawn one and a half
  // screen heights wide
  return (
    <WhenNear className="desktop-wallpaper-frame">
      <Image
        className="desktop-wallpaper"
        src={photo}
        alt=""
        fill
        sizes="(max-aspect-ratio: 3/2) 150vh, 100vw"
        quality={75}
        placeholder="empty"
      />
    </WhenNear>
  );
}
