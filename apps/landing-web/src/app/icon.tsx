import { mark } from "./og/mark";

// Drawn once at build time: the face is read from disk.
export const dynamic = "force-static";
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** The tab, bookmark and search-result icon. */
export default function Icon() {
  return mark(size.width);
}
