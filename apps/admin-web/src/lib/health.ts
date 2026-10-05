/**
 * Readiness of each platform service from its `/health/deep` (terminus
 * format), measured server side over the internal URL.
 */

export type HealthState = "up" | "degraded" | "down" | "unconfigured";

export type ServiceHealth = {
  key: "identity" | "notifications" | "battleship" | "payments" | "education";
  state: HealthState;
  latencyMs: number | null;
  /** Dependencies reported by the service (postgres, valkey, rabbitmq…). */
  checks: { name: string; up: boolean; message: string | null }[];
  checkedAt: string;
};

type Terminus = {
  status?: string;
  info?: Record<string, { status?: string; message?: string }>;
  error?: Record<string, { status?: string; message?: string }>;
  details?: Record<string, { status?: string; message?: string }>;
};

export function readTerminus(body: unknown): ServiceHealth["checks"] {
  const data = (body ?? {}) as Terminus;
  const details = data.details ?? { ...data.info, ...data.error };
  return Object.entries(details ?? {}).map(([name, value]) => ({
    name,
    up: value?.status === "up",
    message: value?.message ?? null,
  }));
}

export async function probe(
  key: ServiceHealth["key"],
  baseUrl: string | undefined,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<ServiceHealth> {
  const now = options.now ?? Date.now;
  const checkedAt = new Date(now()).toISOString();
  if (!baseUrl)
    return {
      key,
      state: "unconfigured",
      latencyMs: null,
      checks: [],
      checkedAt,
    };
  const started = now();
  try {
    const response = await fetch(`${baseUrl}/health/deep`, {
      headers: { accept: "application/json", ...options.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 2500),
    });
    const latencyMs = Math.max(0, Math.round(now() - started));
    const body = await response.json().catch(() => null);
    const checks = readTerminus(body);
    if (response.ok) return { key, state: "up", latencyMs, checks, checkedAt };
    // The process answers but a dependency does not: degraded, with details.
    return {
      key,
      state: checks.length > 0 ? "degraded" : "down",
      latencyMs,
      checks,
      checkedAt,
    };
  } catch {
    return { key, state: "down", latencyMs: null, checks: [], checkedAt };
  }
}
