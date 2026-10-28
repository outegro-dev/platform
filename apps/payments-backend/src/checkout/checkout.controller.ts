import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import {
  AppError,
  type AuthenticatedUser,
  CurrentUser,
} from "@outegro/nest-common";
import { z } from "zod";
import { RequestId } from "../common/request-id.js";
import { currencies } from "../domain/money.js";
import { CheckoutService } from "./checkout.service.js";
import { GrumbleCheckoutService } from "./grumble-checkout.service.js";

/** Strict: a client-sent amount or price is refused, never trusted (TC-PAY-03-04). */
const checkoutSchema = z
  .object({
    productKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    currency: z.enum(currencies),
    returnUrl: z.string().max(2000).optional(),
  })
  .strict();

const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);

/** A purchase with grumbles names only the product: the price is the server's. */
const grumbleCheckoutSchema = z
  .object({ productKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/) })
  .strict();

function requireKey(key: string | undefined) {
  const parsed = idempotencyKeySchema.safeParse(key);
  if (!parsed.success)
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: {
        "Idempotency-Key": [
          "required, 8-128 characters of A-Z a-z 0-9 . _ : -",
        ],
      },
    });
  return parsed.data;
}

@Controller("checkout")
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly grumbles: GrumbleCheckoutService,
  ) {}

  /**
   * Starts (or repeats) a purchase. `Idempotency-Key` is required: the same
   * key and input return the same order; the same key with other input is 409.
   */
  @Post()
  @HttpCode(200)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: checkoutSchema }) body: z.infer<typeof checkoutSchema>,
    @Headers("idempotency-key") key: string | undefined,
    @RequestId() requestId: string | null,
  ) {
    return this.checkout.start(user.userId, body, requireKey(key), requestId);
  }

  /**
   * Buys a one-time product with grumbles (wallet phase 3): `paid`, or
   * `short` with the shortfall and a pack to top up with. The same key
   * returns the same order and finishes one left half-way.
   */
  @Post("grumbles")
  @HttpCode(200)
  buyWithGrumbles(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: grumbleCheckoutSchema })
    body: z.infer<typeof grumbleCheckoutSchema>,
    @Headers("idempotency-key") key: string | undefined,
    @RequestId() requestId: string | null,
  ) {
    return this.grumbles.buy(
      user.userId,
      body.productKey,
      requireKey(key),
      requestId,
    );
  }
}
