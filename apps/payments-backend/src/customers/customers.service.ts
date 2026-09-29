import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
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
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import { eq, sql } from "drizzle-orm";
import type { CustomerRow, PaymentsDatabase } from "../common/database.js";
import { customers } from "../db/schema.js";

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
  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly messaging: Messaging,
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
    const [customer] = await this.database.db
      .select()
      .from(customers)
      .where(eq(customers.userId, userId));
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
