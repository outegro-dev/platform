import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  type AnyEvent,
  defineQueue,
  identityUserContactChanged,
  identityUserCreated,
  identityUserLocaleChanged,
  identityUserStatusChanged,
} from "@outegro/contracts";
import { processOnce } from "@outegro/db";
import {
  CLOCK,
  type Clock,
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import { sql } from "drizzle-orm";
import type { NotificationsDatabase } from "../common/database.js";
import { recipients } from "../db/schema.js";

type Fields = {
  userId: string;
  contact?: { email: string | null; emailVerified: boolean; version: number };
  locale?: { value: "en" | "ru"; version: number };
  status?: { value: string; version: number };
};

export const identityQueue = defineQueue("notifications", "identity-events", [
  {
    producer: "identity",
    types: [
      identityUserCreated.type,
      identityUserContactChanged.type,
      identityUserLocaleChanged.type,
      identityUserStatusChanged.type,
    ],
  },
]);

/**
 * Contact projection: email, locale and status of each user, kept from
 * Identity events. Events may arrive in any order and again (a republish
 * under a new event id): each sets only its fields, and only when it is
 * newer than what is stored, so a late user.created never puts back an
 * old locale and an old contact change never readdresses the mail.
 */
@Injectable()
export class RecipientsService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: NotificationsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly messaging: Messaging,
  ) {}

  async onApplicationBootstrap() {
    await this.messaging.subscribe(identityQueue, (event) => this.apply(event));
  }

  async apply(event: AnyEvent) {
    const { userId, contact, locale, status } = this.fieldsOf(event);
    const now = this.clock.now();
    await processOnce(
      this.database.db,
      {
        consumer: "notifications.identity-events",
        eventId: event.eventId,
        type: event.type,
      },
      async (tx) => {
        await tx
          .insert(recipients)
          .values({
            userId,
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
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: recipients.userId,
            // SET reads the row as it was before this event.
            set: {
              ...(contact
                ? {
                    email: sql`case when ${contact.version} > ${recipients.contactVersion} then ${contact.email}::text else ${recipients.email} end`,
                    emailVerified: sql`case when ${contact.version} > ${recipients.contactVersion} then ${contact.emailVerified}::boolean else ${recipients.emailVerified} end`,
                    contactVersion: sql`greatest(${recipients.contactVersion}, ${contact.version})`,
                  }
                : {}),
              ...(locale
                ? {
                    locale: sql`case when ${locale.version} > ${recipients.localeVersion} then ${locale.value}::text else ${recipients.locale} end`,
                    localeVersion: sql`greatest(${recipients.localeVersion}, ${locale.version})`,
                  }
                : {}),
              ...(status
                ? {
                    // Equal versions apply: the account's first status is 0.
                    status: sql`case when ${status.version} >= ${recipients.statusVersion} then ${status.value}::text else ${recipients.status} end`,
                    statusVersion: sql`greatest(${recipients.statusVersion}, ${status.version})`,
                  }
                : {}),
              updatedAt: now,
            },
          });
      },
    );
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
        };
      }
      default:
        throw new PermanentError(`unexpected event ${event.type}`);
    }
  }
}
