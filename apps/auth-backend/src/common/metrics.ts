import { Injectable } from "@nestjs/common";
import { AppError, type Counter, Metrics } from "@outegro/nest-common";
import type { DeliveryStatus } from "../login/code-delivery.js";

export type SignInMethod = "email" | "google";

/** How a sign-in ended: a small fixed set, never a user or an email. */
type SignInResult =
  | "success"
  | "invalid_code"
  | "expired"
  | "too_many_attempts"
  | "rejected"
  | "conflict"
  | "rate_limited"
  | "forbidden"
  | "unavailable"
  | "error";

const codeReasons: readonly string[] = [
  "invalid_code",
  "expired",
  "too_many_attempts",
];

function resultOf(error: unknown): SignInResult {
  if (!(error instanceof AppError)) return "error";
  switch (error.code) {
    case "UNPROCESSABLE": {
      const reason = error.fieldErrors.code?.[0] ?? "";
      return codeReasons.includes(reason)
        ? (reason as SignInResult)
        : "rejected";
    }
    case "CONFLICT":
      return "conflict";
    case "RATE_LIMITED":
      return "rate_limited";
    case "FORBIDDEN":
      return "forbidden";
    // Google down, or Google sign-in not configured.
    case "DEPENDENCY_UNAVAILABLE":
    case "NOT_FOUND":
      return "unavailable";
    default:
      return "error";
  }
}

/** Identity's sign-in counters (OPS-04). */
@Injectable()
export class IdentityMetrics {
  private readonly signIns: Counter<"method" | "result">;
  private readonly codes: Counter<"result">;

  constructor(metrics: Metrics) {
    this.signIns = metrics.counter({
      name: "identity_sign_in_attempts_total",
      help: "Sign-in attempts by method (email code, Google) and result.",
      labelNames: ["method", "result"],
    });
    this.codes = metrics.counter({
      name: "identity_login_codes_total",
      help: "Login codes handed to Notifications, by delivery result.",
      labelNames: ["result"],
    });
  }

  /** Counts the attempt by how it ended and passes the outcome through. */
  async signIn<T>(method: SignInMethod, attempt: Promise<T>): Promise<T> {
    try {
      const signedIn = await attempt;
      this.signIns.inc({ method, result: "success" });
      return signedIn;
    } catch (error) {
      this.signIns.inc({ method, result: resultOf(error) });
      throw error;
    }
  }

  loginCode(result: DeliveryStatus) {
    this.codes.inc({ result });
  }
}
