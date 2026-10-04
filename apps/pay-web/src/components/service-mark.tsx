import {
  AnchorIcon,
  BookOpenTextIcon,
  PackageIcon,
} from "@phosphor-icons/react/dist/ssr";

const icons: Record<string, typeof AnchorIcon> = {
  battleship: AnchorIcon,
  edu: BookOpenTextIcon,
};

/** A glass tile with the app's glyph; decorative, the name is always in text. */
export function ServiceMark({
  service,
  size,
}: {
  service: string | null;
  size?: "lg";
}) {
  // Own keys only: an unknown service (even "constructor") gets the package.
  const Icon =
    service && Object.hasOwn(icons, service) ? icons[service] : PackageIcon;
  return (
    <span className="service-mark" data-size={size} aria-hidden="true">
      <Icon weight="duotone" />
    </span>
  );
}
