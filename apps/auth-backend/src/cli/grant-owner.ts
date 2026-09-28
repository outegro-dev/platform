import "reflect-metadata";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

/**
 * Operator-only owner bootstrap (ID-07): the first owner is never the first
 * signup. Run inside the pod:
 *   node dist/cli/grant-owner.js --email you@example.com --reason "initial owner"
 * The account must already exist (signed in once).
 */
if (existsSync(".env")) process.loadEnvFile(".env");

const { values } = parseArgs({
  options: { email: { type: "string" }, reason: { type: "string" } },
});
if (!values.email || !values.reason) {
  console.error("Usage: grant-owner --email <email> --reason <text>");
  process.exit(2);
}

const { NestFactory } = await import("@nestjs/core");
const { eq } = await import("drizzle-orm");
const { DATABASE } = await import("@outegro/nest-common");
const { CliModule } = await import("./cli.module.js");
const { RolesService } = await import("../access/roles.service.js");
const { users } = await import("../db/schema.js");

const app = await NestFactory.createApplicationContext(CliModule, {
  logger: ["error", "warn"],
});
try {
  const database = app.get(DATABASE);
  const [user] = await database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, values.email.trim().toLowerCase()));
  if (!user) {
    console.error("No such user. Sign in once with this email first.");
    process.exitCode = 1;
  } else {
    const binding = await app
      .get(RolesService)
      .grant(
        { userId: null },
        { userId: user.id, role: "owner", reason: `cli: ${values.reason}` },
      );
    console.log(
      JSON.stringify({
        granted: "owner",
        userId: user.id,
        bindingId: binding.id,
      }),
    );
  }
} finally {
  await app.close();
}
