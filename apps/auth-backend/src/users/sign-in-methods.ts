import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { and, eq } from "drizzle-orm";
import type { AuthTx } from "../common/database.js";
import { webauthnConfig } from "../config/config.js";
import { identities, passkeys } from "../db/schema.js";

export type RemovedMethod = { google: true } | { passkeyId: string };

/**
 * The last-method rule (chapter 4.2, TC-ID-02-03, TC-ID-05-03): a sign-in
 * method may go only while another usable one stays. Usable means:
 *
 * - the email code, when the anchor email is verified: codes go to that
 *   address, so proving it once makes it a way in for as long as it stays
 *   verified. An unverified anchor is not counted, since a code would
 *   prove nothing about it;
 * - every linked external identity (Google);
 * - every passkey of the relying party configured now (`WEBAUTHN_RP_ID`);
 *   one registered for another RP can no longer sign in.
 *
 * Call it in the transaction that removes the method, after locking the
 * user row (`SELECT … FOR UPDATE`): two removals of the last two methods
 * then run one after the other, and the second sees only one left.
 */
@Injectable()
export class SignInMethods {
  constructor(
    @Inject(webauthnConfig.KEY)
    private readonly webauthn: ConfigType<typeof webauthnConfig>,
  ) {}

  async remainingAfter(
    tx: AuthTx,
    user: { id: string; emailVerified: boolean },
    removed: RemovedMethod,
  ) {
    const linked = await tx
      .select({ provider: identities.provider })
      .from(identities)
      .where(eq(identities.userId, user.id));
    const keys = await tx
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(
        and(
          eq(passkeys.userId, user.id),
          eq(passkeys.rpId, this.webauthn.rpId),
        ),
      );
    const external = linked.filter(
      (identity) => !("google" in removed && identity.provider === "google"),
    ).length;
    const other = keys.filter(
      (key) => !("passkeyId" in removed && key.id === removed.passkeyId),
    ).length;
    return (user.emailVerified ? 1 : 0) + external + other;
  }
}
