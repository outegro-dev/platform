import { AnchorIcon, PackageIcon } from "@phosphor-icons/react/dist/ssr";

const icons: Record<string, typeof AnchorIcon> = {
  battleship: AnchorIcon,
};

/** A glass tile with the app's glyph; decorative, the name is always in text. */
export function ServiceMark({
  service,
  size,
}: {
  service: string | null;
  size?: "lg";
}) {
  const Icon = (service && icons[service]) || PackageIcon;
  return (
    <span className="service-mark" data-size={size} aria-hidden="true">
      <Icon weight="duotone" />
    </span>
  );
}
