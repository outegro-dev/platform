import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  type AnyEvent,
  defineQueue,
  identityRoleBindingChanged,
  identityUserContactChanged,
  identityUserCreated,
  identityUserLocaleChanged,
  identityUserStatusChanged,
} from "@outegro/contracts";
import { processOnce } from "@outegro/db";
import {
  AppError,
  CLOCK,
  type Clock,
  callInternal,
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { CustomerRow, PaymentsDatabase } from "../common/database.js";
import { authConfig } from "../config/config.js";
import { customers } from "../db/schema.js";

/** auth-backend `POST /v1/internal/users/lookup`. */
const identityUserSchema = z.object({
  userId: z.uuid(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  locale: z.enum(["en", "ru"]),
  status: z.enum(["active", "suspended", "deleted"]),
  accessVersion: z.number().int().nonnegative(),
});

export const identityQueue = defineQueue("payments", "identity-events", [
  {
    producer: "identity",
    types: [
      identityUserCreated.type,
      identityUserContactChanged.type,
      identityUserLocaleChanged.type,
      identityUserStatusChanged.type,
      identityRoleBindingChanged.type,
    ],
  },
]);

type Fields = {
  userId: string;
  set: Partial<
    Pick<CustomerRow, "email" | "emailVerified" | "locale" | "status">
  >;
  accessVersion?: number;
};

/**
 * Buyer projection from Identity events: the email Lava needs, the locale
 * for its pages and emails, status, and the latest access version. Events
 * may arrive in any order; each sets only its own fields.
 */
@Injectable()
export class CustomersService implements OnApplicationBootstrap {
  private readonly logger = new Logger("Customers");

  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly messaging: Messaging,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  async onApplicationBootstrap() {
    await this.messaging.subscribe(identityQueue, (event) => this.apply(event));
  }

  async apply(event: AnyEvent) {
    const fields = this.fieldsOf(event);
    const now = this.clock.now();
    const version = fields.accessVersion;
    await processOnce(
      this.database.db,
      {
        consumer: "payments.identity-events",
        eventId: event.eventId,
        type: event.type,
      },
      async (tx) => {
        await tx
          .insert(customers)
          .values({
            userId: fields.userId,
            ...fields.set,
            ...(version === undefined ? {} : { accessVersion: version }),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: customers.userId,
            set: {
              ...fields.set,
              ...(version === undefined
                ? {}
                : {
                    // Versions only grow; a late event cannot lower them.
                    accessVersion: sql`greatest(${customers.accessVersion}, ${version})`,
                  }),
              updatedAt: now,
            },
          });
      },
    );
  }

  /** The buyer data a checkout needs; errors follow the HTTP contract. */
  async forCheckout(userId: string) {
    const find = async () =>
      (
        await this.database.db
          .select()
          .from(customers)
          .where(eq(customers.userId, userId))
      )[0];
    let customer = await find();
    if (!customer) {
      await this.syncFromIdentity(userId);
      customer = await find();
    }
    // Identity events may still be on their way.
    if (!customer)
      throw new AppError("DEPENDENCY_UNAVAILABLE", {
        fieldErrors: { customer: ["not synced yet"] },
        retryable: true,
      });
    if (customer.status !== "active") throw new AppError("FORBIDDEN");
    if (!customer.email || !customer.emailVerified)
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { email: ["a verified email is required"] },
      });
    return { email: customer.email, locale: customer.locale };
  }

  /**
   * A buyer who signed up before this service subscribed to Identity events
   * has no row; ask Identity once. An event that lands meanwhile wins.
   */
  private async syncFromIdentity(userId: string) {
    const { internalUrl, internalToken } = this.auth;
    if (!internalUrl || !internalToken) return;
    let user: z.infer<typeof identityUserSchema>;
    try {
      user = identityUserSchema.parse(
        await callInternal(`${internalUrl}/v1/internal/users/lookup`, {
          token: internalToken,
          body: { userId },
        }),
      );
    } catch (error) {
      this.logger.warn(
        { err: (error as Error).message },
        "Identity lookup for a buyer failed",
      );
      return;
    }
    await this.database.db
      .insert(customers)
      .values({ ...user, updatedAt: this.clock.now() })
      .onConflictDoNothing();
  }

  private fieldsOf(event: AnyEvent): Fields {
    switch (event.type) {
      case identityUserCreated.type: {
        const { payload } = identityUserCreated.schema.parse(event);
        return {
          userId: payload.userId,
          set: { locale: payload.locale, status: payload.status },
        };
      }
      case identityUserContactChanged.type: {
        const { payload } = identityUserContactChanged.schema.parse(event);
        return {
          userId: payload.userId,
          set: { email: payload.email, emailVerified: payload.emailVerified },
        };
      }
      case identityUserLocaleChanged.type: {
        const { payload } = identityUserLocaleChanged.schema.parse(event);
        return { userId: payload.userId, set: { locale: payload.locale } };
      }
      case identityUserStatusChanged.type: {
        const { payload } = identityUserStatusChanged.schema.parse(event);
        return {
          userId: payload.userId,
          set: { status: payload.status },
          accessVersion: payload.accessVersion,
        };
      }
      case identityRoleBindingChanged.type: {
        const { payload } = identityRoleBindingChanged.schema.parse(event);
        return {
          userId: payload.userId,
          set: {},
          accessVersion: payload.accessVersion,
        };
      }
      default:
        throw new PermanentError(`unexpected event ${event.type}`);
    }
  }
}
