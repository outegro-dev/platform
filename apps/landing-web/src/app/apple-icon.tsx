import { mark } from "./og/mark";

// Drawn once at build time: the face is read from disk.
export const dynamic = "force-static";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home-screen and share-sheet icon of iOS: the tab icon, larger. */
export default function AppleIcon() {
  return mark(size.width);
}
