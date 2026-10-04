"use server";

import {
  accessRuleSchema,
  adminReasonSchema,
  bookSlugSchema,
  bookStatusSchema,
} from "@outegro/contracts/edu";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/actions";
import { accessModes, featurePresets, ruleOf } from "@/lib/education";

const expectedVersion = z.coerce.number().int().nonnegative();

const done = {
  published: "done.bookPublished",
  draft: "done.bookDrafted",
  archived: "done.bookArchived",
} as const;

/** Publish a book, move it back to draft, or archive it. */
export async function setBookStatus(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "edu.manage",
    form,
    schema: z.object({
      slug: bookSlugSchema,
      status: bookStatusSchema,
      expectedVersion,
      reason: adminReasonSchema,
    }),
    run: (services, input) =>
      services.education.setStatus(input.slug, {
        status: input.status,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }),
    success: (t, input) => t(done[input.status]),
    // 422: the book already has this status.
    explain: (error) =>
      error.error.code === "UNPROCESSABLE" ? "same-status" : null,
  });
}

/**
 * Who reads a book: anyone, signed-in readers, or holders of a grant with
 * some free chapters. The dialog posts single values (FormData keeps only
 * the last of repeated names); they become the contract's rule here.
 */
export async function setBookAccess(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "edu.manage",
    form,
    schema: z
      .object({
        slug: bookSlugSchema,
        expectedVersion,
        mode: z.enum(accessModes),
        features: z.enum(featurePresets).optional(),
        previewChapters: z.coerce.number().int().min(0).max(50).optional(),
        reason: adminReasonSchema,
      })
      .transform((input, context) => {
        const rule = accessRuleSchema.safeParse(ruleOf(input));
        if (!rule.success) {
          context.addIssue({ code: "custom", message: "invalid rule" });
          return z.NEVER;
        }
        return {
          slug: input.slug,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          rule: rule.data,
        };
      }),
    run: (services, input) =>
      services.education.setAccess(input.slug, {
        rule: input.rule,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }),
    success: (t) => t("done.bookAccessChanged"),
    // 422 names the refusal: the same rule again, or more free chapters
    // than the book has.
    explain: (error) => {
      if (error.error.code !== "UNPROCESSABLE") return null;
      const fields = error.error.fieldErrors;
      if (fields["rule.previewChapters"]) return "free-chapters";
      if (fields.rule?.includes("unchanged")) return "same-rule";
      return "rule-refused";
    },
  });
}
