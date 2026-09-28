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
import type { NotificationsDatabase } from "../common/database.js";
import { recipients } from "../db/schema.js";

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
 * Identity events. Events may arrive in any order; each only sets its fields.
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
    const fields = this.fieldsOf(event);
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
          .values({ userId: fields.userId, ...fields.set, updatedAt: now })
          .onConflictDoUpdate({
            target: recipients.userId,
            set: { ...fields.set, updatedAt: now },
          });
      },
    );
  }

  private fieldsOf(event: AnyEvent) {
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
        return { userId: payload.userId, set: { status: payload.status } };
      }
      default:
        throw new PermanentError(`unexpected event ${event.type}`);
    }
  }
}
