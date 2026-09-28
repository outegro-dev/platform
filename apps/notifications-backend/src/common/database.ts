import type { DatabaseHandle } from "@outegro/nest-common";
import type * as schema from "../db/schema.js";

export type NotificationsDatabase = DatabaseHandle<typeof schema>;
