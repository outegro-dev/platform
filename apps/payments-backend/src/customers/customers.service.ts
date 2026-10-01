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
  OutboxRelay,
  PermanentError,
} from "@outegro/nest-common";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { CancellationService } from "../billing/cancellation.js";
import type {
  CustomerRow,
  PaymentsDatabase,
  PaymentsTx,
} from "../common/database.js";
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
  /** The user's aggregateVersion; an Identity before it does not send it. */
  version: z.number().int().nonnegative().optional(),
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

type AccountStatus = "active" | "suspended" | "deleted";

type Fields = {
  userId: string;
  /** Email and its verification, and the user's aggregateVersion they carry. */
  contact?: { email: string | null; emailVerified: boolean; version: number };
  /** The locale and the user's aggregateVersion it carries. */
  locale?: { value: CustomerRow["locale"]; version: number };
  /** The account status and Identity's accessVersion it was set at. */
  status?: { value: AccountStatus; version: number };
  accessVersion?: number;
};

/**
 * Buyer projection from Identity events: the email Lava needs, the locale
 * for its pages and emails, status, and the latest access version. Events
 * may arrive in any order; each sets only its own fields. The email and the
 * locale are each kept with the user's aggregateVersion they came with
 * (Identity bumps it with every change of the user), and only a newer one
 * replaces them: a late user.created or an older change delivered again
 * leaves the newer data. A status replaces the stored one only if it is
 * not older: Identity bumps accessVersion with every status change, and
 * user.created carries the status from before any change (version 0). Role
 * changes bump accessVersion too, but say nothing about the status, so they
 * never hold a status back. An account suspended or deleted stops the
 * renewal of its subscriptions in the same transaction, when that status is
 * the one stored.
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
    private readonly cancellation: CancellationService,
    private readonly relay: OutboxRelay,
  ) {}

  async onApplicationBootstrap() {
    await this.messaging.subscribe(identityQueue, (event) => this.apply(event));
  }

  async apply(event: AnyEvent) {
    const fields = this.fieldsOf(event);
    const now = this.clock.now();
    const { contact, locale, status, accessVersion } = fields;
    let stopped = 0;
    await processOnce(
      this.database.db,
      {
        consumer: "payments.identity-events",
        eventId: event.eventId,
        type: event.type,
      },
      async (tx) => {
        // One statement, so the version check and the write see the same
        // row even when two events of a new account race to insert it.
        const [stored] = await tx
          .insert(customers)
          .values({
            userId: fields.userId,
            ...(contact
              ? {
                  email: contact.email,
                  emailVerified: contact.emailVerified,
                  contactVersion: contact.version,
                }
              : {}),
            ...(locale
              ? { locale: locale.value, localeVersion: locale.version }
              : {}),
            ...(status
              ? { status: status.value, statusVersion: status.version }
              : {}),
            ...(accessVersion === undefined ? {} : { accessVersion }),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: customers.userId,
            set: {
              // A contact or locale not newer than the stored one (a late
              // or repeated event) is dropped. SET reads the row as it was.
              ...(contact
                ? {
                    email: sql`case when ${contact.version} > ${customers.contactVersion} then ${contact.email}::text else ${customers.email} end`,
                    emailVerified: sql`case when ${contact.version} > ${customers.contactVersion} then ${contact.emailVerified}::boolean else ${customers.emailVerified} end`,
                    contactVersion: sql`greatest(${customers.contactVersion}, ${contact.version})`,
                  }
                : {}),
              ...(locale
                ? {
                    locale: sql`case when ${locale.version} > ${customers.localeVersion} then ${locale.value}::text else ${customers.locale} end`,
                    localeVersion: sql`greatest(${customers.localeVersion}, ${locale.version})`,
                  }
                : {}),
              ...(status
                ? {
                    // An older status (a late or repeated event) is dropped.
                    status: sql`case when ${status.version} >= ${customers.statusVersion} then ${status.value} else ${customers.status} end`,
                    statusVersion: sql`greatest(${customers.statusVersion}, ${status.version})`,
                  }
                : {}),
              ...(accessVersion === undefined
                ? {}
                : {
                    // Versions only grow; a late event cannot lower them.
                    accessVersion: sql`greatest(${customers.accessVersion}, ${accessVersion})`,
                  }),
              updatedAt: now,
            },
          })
          .returning({ statusVersion: customers.statusVersion });
        // Lava must not charge a closed account again. Paid time is kept;
        // renewal stays off if the account comes back. Only the status
        // stored now acts: one older than it is not acted on.
        if (
          status &&
          status.value !== "active" &&
          stored?.statusVersion === status.version
        )
          stopped = await this.cancellation.stopRenewalsOfClosedAccount(
            // processOnce runs it in a transaction of this service's database.
            tx as PaymentsTx,
            {
              userId: fields.userId,
              status: status.value,
              eventId: event.eventId,
            },
            now,
          );
      },
    );
    if (stopped > 0) this.relay.kick();
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
    // The status Identity reports is current as of its accessVersion, the
    // contact and locale as of the user's version (0 when not sent).
    const { version = 0, ...current } = user;
    await this.database.db
      .insert(customers)
      .values({
        ...current,
        statusVersion: user.accessVersion,
        contactVersion: version,
        localeVersion: version,
        updatedAt: this.clock.now(),
      })
      .onConflictDoNothing();
  }

  private fieldsOf(event: AnyEvent): Fields {
    switch (event.type) {
      case identityUserCreated.type: {
        const { payload, aggregateVersion } =
          identityUserCreated.schema.parse(event);
        return {
          userId: payload.userId,
          locale: { value: payload.locale, version: aggregateVersion },
          // The status an account starts with, before any change.
          status: { value: payload.status, version: 0 },
        };
      }
      case identityUserContactChanged.type: {
        const { payload, aggregateVersion } =
          identityUserContactChanged.schema.parse(event);
        return {
          userId: payload.userId,
          contact: {
            email: payload.email,
            emailVerified: payload.emailVerified,
            version: aggregateVersion,
          },
        };
      }
      case identityUserLocaleChanged.type: {
        const { payload, aggregateVersion } =
          identityUserLocaleChanged.schema.parse(event);
        return {
          userId: payload.userId,
          locale: { value: payload.locale, version: aggregateVersion },
        };
      }
      case identityUserStatusChanged.type: {
        const { payload } = identityUserStatusChanged.schema.parse(event);
        return {
          userId: payload.userId,
          status: { value: payload.status, version: payload.accessVersion },
          accessVersion: payload.accessVersion,
        };
      }
      case identityRoleBindingChanged.type: {
        const { payload } = identityRoleBindingChanged.schema.parse(event);
        return { userId: payload.userId, accessVersion: payload.accessVersion };
      }
      default:
        throw new PermanentError(`unexpected event ${event.type}`);
    }
  }
}
