import { Button } from "@outegro/ui/button";
import { StatePanel } from "@outegro/ui/notice";
import {
  ArrowClockwiseIcon,
  CloudSlashIcon,
} from "@phosphor-icons/react/dist/ssr";

/**
 * A read that failed (edu-backend slow or down): say so and offer a retry
 * in place, with the header and footer still there (kit StatePanel).
 */
export function Unavailable({
  title,
  body,
  retry,
  href,
}: {
  title: string;
  body: string;
  retry: string;
  /** This page, reloaded by the retry. */
  href: string;
}) {
  return (
    <StatePanel
      tone="danger"
      live="assertive"
      icon={<CloudSlashIcon aria-hidden="true" />}
      title={title}
      description={body}
      actions={
        <Button asChild size="lg" variant="outline">
          <a href={href}>
            <ArrowClockwiseIcon aria-hidden="true" />
            {retry}
          </a>
        </Button>
      }
    />
  );
}
