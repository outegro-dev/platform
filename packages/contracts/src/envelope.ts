import { z } from "zod";

/** Services that own and publish events. */
export const producers = [
  "identity",
  "notifications",
  "payments",
  "admin",
  "assistant",
  "battleship",
  "edu",
] as const;
export type Producer = (typeof producers)[number];

const envelopeFields = {
  eventId: z.uuid(),
  schemaVersion: z.number().int().positive(),
  occurredAt: z.iso.datetime({ offset: false }),
  aggregateId: z.uuid(),
  aggregateVersion: z.number().int().nonnegative(),
  producer: z.enum(producers),
  correlationId: z.string().min(1).max(128).optional(),
  causationId: z.string().min(1).max(128).optional(),
};

/** Envelope with an unparsed payload: the first step for every consumer. */
export const anyEventSchema = z.object({
  ...envelopeFields,
  type: z.string().regex(/^[a-z]+(\.[a-z-]+)+\.v\d+$/),
  payload: z.unknown(),
});
export type AnyEvent = z.infer<typeof anyEventSchema>;

export type EventDefinition<
  Type extends string = string,
  Payload extends z.ZodType = z.ZodType,
> = {
  type: Type;
  schemaVersion: number;
  /** Owning producer, or "any" for commands every service may publish. */
  producer: Producer | "any";
  payload: Payload;
  /** Full envelope schema with the typed payload. */
  schema: z.ZodObject<
    typeof envelopeFields & { type: z.ZodLiteral<Type>; payload: Payload }
  >;
};

/**
 * Declares a versioned event. The version is part of the type
 * (`identity.user.created.v1`), so a breaking change is a new event.
 */
export function defineEvent<Type extends string, Payload extends z.ZodType>(
  type: Type,
  producer: Producer | "any",
  payload: Payload,
): EventDefinition<Type, Payload> {
  const match = /\.v(\d+)$/.exec(type);
  if (!match?.[1]) throw new Error(`Event type must end with .vN: ${type}`);
  return {
    type,
    schemaVersion: Number(match[1]),
    producer,
    payload,
    schema: z.object({
      ...envelopeFields,
      type: z.literal(type),
      payload,
    }),
  };
}

export type EventOf<D extends EventDefinition> = z.infer<D["schema"]>;
export type PayloadOf<D extends EventDefinition> = z.infer<D["payload"]>;

/**
 * Builds a complete envelope. `producer` defaults to the definition owner;
 * commands defined for "any" producer must pass it explicitly.
 */
export function createEvent<D extends EventDefinition>(
  definition: D,
  input: {
    aggregateId: string;
    aggregateVersion: number;
    payload: z.input<D["payload"]>;
    producer?: Producer;
    occurredAt?: Date;
    correlationId?: string;
    causationId?: string;
  },
): EventOf<D> {
  const producer =
    input.producer ??
    (definition.producer === "any" ? undefined : definition.producer);
  if (!producer)
    throw new Error(`${definition.type} needs an explicit producer`);
  return definition.schema.parse({
    eventId: globalThis.crypto.randomUUID(),
    type: definition.type,
    schemaVersion: definition.schemaVersion,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    producer,
    correlationId: input.correlationId,
    causationId: input.causationId,
    payload: input.payload,
  }) as EventOf<D>;
}
