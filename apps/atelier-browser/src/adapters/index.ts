import type { AtsAdapter, BrowserAts } from "./adapter.js";
import { ashby } from "./ashby.js";
import { greenhouse } from "./greenhouse.js";
import { lever } from "./lever.js";
import { workable } from "./workable.js";

export type { AtsAdapter, BrowserAts } from "./adapter.js";

export const adapters: Record<BrowserAts, AtsAdapter> = {
  ashby,
  lever,
  greenhouse,
  workable,
};
