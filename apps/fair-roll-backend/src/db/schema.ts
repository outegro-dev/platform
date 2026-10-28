import {
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/**
 * A published chain: its commit (seed[0]) and the public seed announced with
 * it. Both are public; the root never reaches the database.
 */
export const chains = pgTable("chains", {
  commit: text("commit").primaryKey(),
  publicSeed: text("public_seed").notNull(),
  length: integer("length").notNull(),
  createdAt: at("created_at").notNull(),
});

/** Revealed rounds, strictly in order: round k only after round k − 1. */
export const reveals = pgTable(
  "reveals",
  {
    commit: text("commit")
      .notNull()
      .references(() => chains.commit),
    round: integer("round").notNull(),
    seed: text("seed").notNull(),
    number: smallint("number").notNull(),
    revealedAt: at("revealed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.commit, t.round] })],
);
