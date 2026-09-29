import { type FormEvent, useState } from "react";
import { isOffline, useOnline } from "./online";

export type FeedbackPhase = "idle" | "pending" | "offline" | "result";

/**
 * What a settings form shows next to its button: progress while saving, the
 * server's answer after it, "offline" when a submit was stopped for lack of
 * a connection — and nothing once the user edits again, so an old "Saved."
 * never sits next to unsaved changes.
 */
export function useFormFeedback<State>(state: State, pending: boolean) {
  const online = useOnline();
  const [offlineOn, setOfflineOn] = useState<State | null>(null);
  const [editedOn, setEditedOn] = useState<State | null>(null);
  const [seen, setSeen] = useState(state);
  const [epoch, setEpoch] = useState(0);
  if (seen !== state) {
    setSeen(state);
    setEpoch(epoch + 1);
  }
  const phase: FeedbackPhase = pending
    ? "pending"
    : offlineOn === state && !online
      ? "offline"
      : editedOn === state
        ? "idle"
        : "result";
  return {
    phase,
    /**
     * Changes with every answer; use it as the `key` of checkbox and radio
     * groups. React resets a form after its action, which puts checkboxes
     * and radios back to how they were first rendered (text inputs keep
     * their value); remounting them shows the controlled state again.
     */
    epoch,
    /** Stops an offline submit before it waits for a network timeout. */
    onSubmit(event: FormEvent<HTMLFormElement>) {
      if (!isOffline()) return;
      event.preventDefault();
      setOfflineOn(state);
    },
    /** Call on every change to the form's fields. */
    onEdit() {
      setEditedOn(state);
    },
  };
}
