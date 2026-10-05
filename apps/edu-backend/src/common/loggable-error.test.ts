import { inspect } from "node:util";
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ModelFailure } from "../domain/assist/text-model.js";
import { loggableError } from "./loggable-error.js";

const SECRET = "Ответ модели, которого нет в логах";

describe("an error for the log", () => {
  it("keeps a failed query's class and the driver's code, never the text it tried to write", () => {
    const driver = Object.assign(new Error(`violates: ${SECRET}`), {
      code: "P0001",
      detail: SECRET,
    });
    const failed = new DrizzleQueryError(
      'insert into "assist_cache" ("key", "text") values ($1, $2)',
      ["key", SECRET],
      driver,
    );
    // What a plain { err } would have logged.
    expect(inspect(failed, { depth: 5 })).toContain(SECRET);
    const logged = loggableError(failed);
    expect(logged).toEqual({ name: "DrizzleQueryError", code: "P0001" });
    expect(inspect(logged, { depth: 5 })).not.toContain(SECRET);
  });

  it("keeps names and well-formed codes only", () => {
    expect(
      loggableError(new SyntaxError(`Unexpected token "${SECRET}"`)),
    ).toEqual({ name: "SyntaxError" });
    expect(
      loggableError(
        new ModelFailure("invalid", "MiniMax sent an unreadable event"),
      ),
    ).toEqual({ name: "ModelFailure" });
    expect(
      loggableError(
        Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      ),
    ).toEqual({ name: "Error", code: "ECONNRESET" });
    // A name or a code that is free text is no name or code.
    expect(
      loggableError(
        Object.assign(new Error("x"), { name: SECRET, code: SECRET }),
      ),
    ).toEqual({ name: "Error" });
    expect(loggableError(SECRET)).toEqual({ name: "string" });
    expect(loggableError(null)).toEqual({ name: "null" });
    expect(loggableError({ message: SECRET })).toEqual({ name: "object" });
  });
});
