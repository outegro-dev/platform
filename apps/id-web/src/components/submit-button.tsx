"use client";

import { Button, type ButtonProps } from "@outegro/ui/button";
import { useFormStatus } from "react-dom";

/**
 * Submit button that shows its own form's pending state: a spinner over the
 * kept label, `aria-busy`, and focus stays on it. `disabled` blocks it while
 * another form is busy; it never applies to the button that is submitting.
 */
export function SubmitButton({
  disabled,
  ...props
}: Omit<ButtonProps, "type" | "pending" | "asChild">) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      pending={pending}
      disabled={pending ? undefined : disabled}
      {...props}
    />
  );
}
