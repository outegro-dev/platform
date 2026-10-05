import { makeAutoObservable } from "mobx";

/**
 * Which section of the chapter the reader is in: the last section heading
 * above the reading line. The contents mark it (aria-current="location");
 * the page's observer of the headings reports it here.
 */
export class SectionSpyStore {
  current: string | null = null;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  show(id: string | null) {
    if (this.current !== id) this.current = id;
  }
}
