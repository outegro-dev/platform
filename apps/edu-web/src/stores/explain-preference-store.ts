import { type ExplainKind, explainKinds } from "@outegro/contracts/edu";
import { makeAutoObservable } from "mobx";
import type { KeyValueStorage } from "@/lib/browser";

/** Where a signed-out reader's choice is kept in this browser. */
export const EXPLAIN_VIEW_KEY = "edu.explainView";

const isExplainKind = (value: unknown): value is ExplainKind =>
  explainKinds.includes(value as ExplainKind);

type Deps = {
  signedIn: boolean;
  storage: KeyValueStorage;
  /** Saves the preference to the account (signed in). */
  save: (view: ExplainKind) => Promise<unknown>;
};

/**
 * How the reader likes things explained ("In plain words", "In code"…):
 * the view "See it from different angles" blocks open with. Signed in it
 * comes with the page and is saved to the account; signed out it lives in
 * this browser. A preference, not progress: a failed save shows nothing,
 * the choice still applies on the page.
 */
export class ExplainPreferenceStore {
  view: ExplainKind | null;
  private readonly deps: Deps;

  constructor(initial: ExplainKind | null, deps: Deps) {
    this.view = isExplainKind(initial) ? initial : null;
    this.deps = deps;
    makeAutoObservable<this, "deps">(this, { deps: false }, { autoBind: true });
  }

  /** Signed out: the choice kept in this browser, once the page runs. */
  restore() {
    if (this.deps.signedIn) return;
    const stored = this.deps.storage.get(EXPLAIN_VIEW_KEY);
    if (isExplainKind(stored)) this.view = stored;
  }

  choose(kind: ExplainKind) {
    if (!isExplainKind(kind)) return;
    this.view = kind;
    if (this.deps.signedIn) void this.deps.save(kind).catch(() => undefined);
    else this.deps.storage.set(EXPLAIN_VIEW_KEY, kind);
  }
}
