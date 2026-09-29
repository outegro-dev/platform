import { Button, type ButtonProps } from "@outegro/ui/button";
import { cn } from "@outegro/ui/lib/utils";
import { Spinner } from "./spinner";

/**
 * A button that shows a spinner while its action runs. The label keeps its
 * place (hidden, not removed), so the button never changes size; while busy
 * it stays focusable (aria-disabled) and ignores activation.
 */
export function BusyButton({
  busy,
  busyLabel,
  children,
  className,
  onClick,
  disabled,
  ...props
}: ButtonProps & { busy: boolean; busyLabel: string }) {
  return (
    <Button
      {...props}
      disabled={disabled}
      className={cn("busy-button", className)}
      data-busy={busy || undefined}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      <span className="busy-label contents">{children}</span>
      {busy && (
        <span className="busy-indicator">
          <Spinner />
          <span className="sr-only">{busyLabel}</span>
        </span>
      )}
    </Button>
  );
}
