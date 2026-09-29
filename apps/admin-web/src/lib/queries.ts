import { cache } from "react";
import type { AuditSource, Fetcher, TimelineEntry } from "./audit";
import { env } from "./env";
import { probe } from "./health";
import { load } from "./result";
import { forwardedHeaders, getOperator, services } from "./server";

/**
 * Reads shared by several panels of one page, deduplicated per request
 * (the dashboard's attention list and the notifications panel read the
 * same overview once).
 */

export const identityOverview = cache(() =>
  load(() => services().identity.overview()),
);

export const userDetail = cache((id: string) =>
  load(() => services().identity.user(id)),
);

/**
 * The name behind an audit actor, for operators who may read users (null
 * otherwise, and the feed shows the short ID). The same few operators act
 * again and again, so each is read once per request.
 */
export const actorName = cache(async (id: string): Promise<string | null> => {
  const me = await getOperator();
  if (!me.ok || !me.data.permissions.includes("users.read")) return null;
  if (me.data.id === id) return me.data.displayName;
  const result = await userDetail(id);
  return result.ok ? result.data.user.displayName : null;
});

export const notificationsOverview = cache(() =>
  load(() => services().notifications.overview()),
);

export const telegramStatus = cache(() =>
  load(() => services().notifications.telegram()),
);

export const channelSettings = cache(() =>
  load(() => services().notifications.settings()),
);

export const templatesList = cache(() =>
  load(() => services().notifications.templates()),
);

export const battleshipOverview = cache(() =>
  load(() => services().battleship.overview()),
);

export const paymentsCatalog = cache(() =>
  load(() => services().payments.catalog()),
);

export const paymentsStats = cache((from?: string, to?: string) =>
  load(() => services().payments.stats({ from, to })),
);

export const openIssues = cache(() =>
  load(() => services().payments.issues({ status: "open", limit: 100 })),
);

export const unmatchedEvents = cache(() =>
  load(() => services().payments.events({ status: "unmatched", limit: 100 })),
);

export const reviewRefunds = cache(() =>
  load(() =>
    services().payments.refunds({ state: "review_required", limit: 100 }),
  ),
);

/** Readiness of every backend, measured in parallel over internal URLs. */
export const serviceHealth = cache(async () => {
  const headers = await forwardedHeaders();
  return Promise.all([
    probe("identity", env.AUTH_API_URL, { headers }),
    probe("notifications", env.NOTIFICATIONS_API_URL, { headers }),
    probe("battleship", env.BATTLESHIP_API_URL, { headers }),
    probe("payments", env.PAYMENTS_ADMIN_API_URL, { headers }),
  ]);
});

/** Audit feeds as merge sources; filters a feed supports go to it. */
export function auditFetchers(
  granted: ReadonlySet<string>,
  filter: { action?: string; targetId?: string; actorId?: string } = {},
): Partial<Record<AuditSource, Fetcher>> {
  const svc = services();
  const sources: Partial<Record<AuditSource, Fetcher>> = {};
  const tag =
    (source: AuditSource) =>
    (entry: Omit<TimelineEntry, "source">): TimelineEntry => ({
      ...entry,
      source,
    });
  if (granted.has("audit.read")) {
    sources.identity = async (cursor, limit) => {
      const page = await svc.identity.audit({
        cursor: cursor ?? undefined,
        limit,
        action: filter.action,
        targetId: filter.targetId,
        actorId: filter.actorId,
      });
      return {
        items: page.items.map((entry) =>
          tag("identity")({
            id: entry.id,
            actorId: entry.actorId,
            action: entry.action,
            targetType: entry.targetType,
            targetId: entry.targetId,
            reason: entry.reason,
            data: entry.data ?? {},
            createdAt: entry.createdAt,
          }),
        ),
        nextCursor: page.nextCursor,
      };
    };
    sources.notifications = async (cursor, limit) => {
      const page = await svc.notifications.audit({
        cursor: cursor ?? undefined,
        limit,
      });
      return {
        items: page.items.map((entry) =>
          tag("notifications")({ ...entry, data: entry.data ?? {} }),
        ),
        nextCursor: page.nextCursor,
      };
    };
  }
  if (granted.has("battleship.read") && svc.battleship.configured) {
    sources.battleship = async (cursor, limit) => {
      const page = await svc.battleship.audit({
        cursor: cursor ?? undefined,
        limit,
        targetId: filter.targetId,
      });
      return {
        items: page.items.map(tag("battleship")),
        nextCursor: page.nextCursor,
      };
    };
  }
  if (
    granted.has("audit.read") &&
    granted.has("billing.read") &&
    svc.payments.configured
  ) {
    sources.payments = async (cursor, limit) => {
      const page = await svc.payments.audit({
        cursor: cursor ?? undefined,
        limit,
      });
      return {
        items: page.items.map((entry) =>
          tag("payments")({
            ...entry,
            data: (entry.data as Record<string, unknown>) ?? {},
          }),
        ),
        nextCursor: page.nextCursor,
      };
    };
  }
  return sources;
}
