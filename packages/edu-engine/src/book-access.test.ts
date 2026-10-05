import { chapterAccessSchema } from "@outegro/contracts/edu";
import { describe, expect, it } from "vitest";
import { readableAccess } from "./access.js";
import { fullAccess, isFullAccess } from "./book-access.js";

describe("full access", () => {
  it("is open, a grant or staff; a preview is readable but not full", () => {
    expect(
      chapterAccessSchema.options.filter((access) => isFullAccess(access)),
    ).toEqual(["open", "granted", "staff"]);
    expect(isFullAccess("preview")).toBe(false);
    expect(readableAccess).toContain("preview");
  });

  it("opens nothing a chapter's access would keep closed", () => {
    for (const access of fullAccess) expect(readableAccess).toContain(access);
    expect(Object.isFrozen(fullAccess)).toBe(true);
  });
});
