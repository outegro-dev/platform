import {
  answerForm,
  type CvDraft,
  emailRu,
  type MaterialKind,
  telegramRu,
  textChecks,
  textsPrompt,
} from "@outegro/atelier-engine";
import {
  type BrowserApplyRequest,
  browserAtsSchema,
  type ChannelKind,
  type Profile,
  profileSchema,
  type VacancyAnalysis,
  type VacancyFields,
  vacancyAnalysisSchema,
  vacancyFieldsSchema,
} from "@outegro/contracts/atelier";
import { z } from "zod";
import { formAtsOf, json } from "./common.js";
import {
  fail,
  needsHuman,
  ok,
  PortError,
  type StepContext,
  type StepHandler,
  type TaskOf,
} from "./step-handler.js";

type Material = {
  kind: string;
  locale: "en" | "ru";
  subject: string | null;
  body: string;
};

/** A template answer is a body, or a subject and a body. */
function asMaterial(kind: string, value: unknown): Material | null {
  if (typeof value === "string" && value.trim())
    return { kind, locale: "ru", subject: null, body: value };
  if (value && typeof value === "object") {
    const { subject, body } = value as { subject?: unknown; body?: unknown };
    if (typeof body === "string" && body.trim())
      return {
        kind,
        locale: "ru",
        subject: typeof subject === "string" ? subject : null,
        body,
      };
  }
  return null;
}

type TextsInput = {
  profile: Profile;
  analysis: VacancyAnalysis;
  fields: VacancyFields;
  draft: CvDraft;
  kinds: MaterialKind[];
};

/**
 * texts: the Telegram message and the Russian email from templates (no
 * model); one model call only when other kinds were asked for.
 */
export const textsStep: StepHandler<TextsInput> = {
  type: "texts",
  contract: 1,
  input: z.object({
    profile: profileSchema,
    analysis: vacancyAnalysisSchema,
    fields: vacancyFieldsSchema,
    draft: json<CvDraft>("draft"),
    kinds: z.array(z.string()).transform((kinds) => kinds as MaterialKind[]),
  }),
  async handle(task, ctx) {
    const { profile, analysis, fields, draft, kinds } = task.input;
    const materials: Material[] = [];
    const telegram = asMaterial(
      "telegram",
      telegramRu(profile, analysis, fields),
    );
    if (telegram) materials.push(telegram);
    const email = asMaterial("email_ru", emailRu(profile, analysis, fields));
    if (email) materials.push(email);
    if (kinds.length) {
      const written = await ctx.llm.generate<{ materials: Material[] }>(
        textsPrompt({
          profile,
          analysis,
          fields,
          cv: draft,
          kinds,
          questions: [],
        }),
      );
      materials.push(...written.materials);
    }
    // The checks fix long dashes in place and name what a person should look at.
    const issues: { kind: string; issues: string[] }[] = [];
    const checked = materials.map((material) => {
      const result = textChecks(material.body, material.kind);
      if (result.issues.length)
        issues.push({ kind: material.kind, issues: result.issues });
      return { ...material, body: result.text };
    });
    return ok({ materials: checked, issues });
  },
};

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const telegramPattern = /(?:t\.me\/|telegram\.me\/)([A-Za-z0-9_]{5,32})/i;

/** channel: the ATS form when there is an adapter, else a contact in the text. */
export const channelStep: StepHandler<{ fields: VacancyFields }> = {
  type: "channel",
  contract: 1,
  input: z.object({ fields: vacancyFieldsSchema }),
  async handle(task) {
    const { fields } = task.input;
    const candidates = [fields.applyUrl, fields.originalUrl, fields.url];
    for (const url of candidates) {
      const ats = formAtsOf(url);
      if (url && ats)
        return ok({ channel: "ats_form", target: url, ats, applyUrl: url });
    }
    const pick = (channel: ChannelKind, target: string) =>
      ok({ channel, target, ats: null, applyUrl: fields.applyUrl });
    const email = fields.text.match(emailPattern)?.[0];
    if (email) return pick("email", email.toLowerCase());
    const telegram = fields.text.match(telegramPattern)?.[1];
    if (telegram) return pick("telegram", `@${telegram}`);
    return pick("manual", fields.applyUrl ?? fields.originalUrl ?? fields.url);
  },
};

type SendInput = {
  mode: "prepare" | "submit";
  channel: {
    channel: ChannelKind;
    target: string;
    ats: z.infer<typeof browserAtsSchema> | null;
    applyUrl: string | null;
  };
  profile: Profile;
  fields: VacancyFields;
  analysis: VacancyAnalysis | null;
  draft: CvDraft | null;
  cv: { storageKey: string; fileName: string };
  coverLetter: string | null;
  answers: { question: string; answer: string }[];
};

type Answer = {
  question: string;
  answer: string;
  source: "bank" | "model" | "manual";
};

/** The person as the form fields want it. */
function formFields(profile: Profile): BrowserApplyRequest["fields"] {
  const person = profile.person;
  const current = [...profile.companies]
    .sort((a, b) => a.order - b.order)
    .find((company) => /present|now|current|настоящ/i.test(company.dates));
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    fullName: person.name,
    email: person.email,
    phone: person.phoneDisplay,
    location: profile.form.location,
    linkedin: person.linkedin,
    github: person.github,
    website: person.website,
    currentCompany: current?.name ?? null,
    currentTitle: current?.title ?? null,
  };
}

/** Answers for the questions the form left open: the answer bank, then the model. */
async function answerQuestions(
  input: SendInput,
  open: {
    label: string;
    type: string;
    required: boolean;
    options: string[] | null;
  }[],
  ctx: StepContext,
): Promise<Answer[]> {
  const known = new Map(
    input.answers.map((item) => [item.question, item.answer]),
  );
  const result: Answer[] = [];
  const freeText: string[] = [];
  for (const field of open) {
    const manual = known.get(field.label);
    if (manual !== undefined) {
      result.push({ question: field.label, answer: manual, source: "manual" });
      continue;
    }
    const bank = answerForm(
      field.label,
      field.options,
      input.profile,
      input.fields,
    );
    if (bank.answer && bank.confidence >= 0.5) {
      result.push({
        question: field.label,
        answer: bank.answer,
        source: "bank",
      });
      continue;
    }
    // The bank knows the field stays empty (pronouns, social handles).
    if (bank.answer === null && bank.confidence >= 0.9) continue;
    // The model writes required free-text answers and optional long ones
    // (cover letter, "anything else"); optional one-liners stay empty.
    if (
      !field.options?.length &&
      /text|textarea|string/i.test(field.type) &&
      (field.required || /textarea/i.test(field.type))
    )
      freeText.push(field.label);
  }
  if (freeText.length && input.analysis && input.draft) {
    const written = await ctx.llm.generate<{
      answers: { question: string; answer: string }[];
    }>(
      textsPrompt({
        profile: input.profile,
        analysis: input.analysis,
        fields: input.fields,
        cv: input.draft,
        kinds: [],
        questions: freeText,
      }),
      { key: "answers" },
    );
    for (const item of written.answers)
      if (item.answer.trim())
        result.push({
          question: item.question,
          answer: item.answer,
          source: "model",
        });
  }
  return result;
}

/**
 * send: an ATS form through atelier-browser: prepare (fill, read the open
 * questions) → answers → submit. Other channels are a person's task for now
 * (Gmail and the Telegram user bot are not connected yet).
 */
export const sendStep: StepHandler<SendInput> = {
  type: "send",
  contract: 1,
  input: z.object({
    mode: z.enum(["prepare", "submit"]),
    channel: z.object({
      channel: z.enum(["ats_form", "email", "telegram", "linkedin", "manual"]),
      target: z.string(),
      ats: browserAtsSchema.nullable(),
      applyUrl: z.string().nullable(),
    }),
    profile: profileSchema,
    fields: vacancyFieldsSchema,
    analysis: vacancyAnalysisSchema.nullable(),
    draft: json<CvDraft>("draft").nullable(),
    cv: z.object({
      storageKey: z.string().min(1),
      fileName: z.string().min(1),
    }),
    coverLetter: z.string().nullable(),
    answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  }),
  async handle(task: TaskOf<SendInput>, ctx) {
    const input = task.input;
    const { channel } = input;
    if (channel.channel !== "ats_form" || !channel.ats || !channel.applyUrl)
      return needsHuman(
        `send by hand via ${channel.channel}: ${channel.target} (only ATS forms are automated)`,
      );
    const file = await ctx.storage.get(input.cv.storageKey);
    if (!file) return fail("cv_missing", "the CV file is not in storage");
    const request = (
      mode: "prepare" | "submit",
      answers: Answer[],
    ): BrowserApplyRequest => ({
      mode,
      applyUrl: channel.applyUrl as string,
      ats: channel.ats as NonNullable<SendInput["channel"]["ats"]>,
      fields: formFields(input.profile),
      answers: answers.map(({ question, answer }) => ({ question, answer })),
      cv: { fileName: input.cv.fileName, base64: file.body.toString("base64") },
      coverLetter: input.coverLetter,
      timezone: input.profile.form.timezone,
    });
    const prepared = await ctx.browser.apply(request("prepare", []));
    if (prepared.status === "needs_human" || prepared.status === "failed")
      return needsHuman(
        prepared.reason ??
          `the form could not be prepared (${prepared.status})`,
        {
          unanswered: prepared.unanswered,
        },
      );
    const answers = await answerQuestions(input, prepared.unanswered, ctx);
    const answered = new Set(answers.map((item) => item.question));
    const missing = prepared.unanswered.filter(
      (field) => field.required && !answered.has(field.label),
    );
    // atelier-browser shoots JPEG: the filled form, then the page after submit.
    const keep = async (base64: string | null, name: string) =>
      base64
        ? (
            await ctx.storage.put(
              `screens/${task.jobId}/${task.id}-${name}.jpg`,
              Buffer.from(base64, "base64"),
              "image/jpeg",
            )
          ).key
        : null;
    const screenshotKey = await keep(prepared.screenshotBase64, "filled");
    if (input.mode === "prepare")
      return ok({
        status: "prepared",
        answers,
        confirmation: null,
        screenshotKey,
      });
    if (missing.length)
      return needsHuman(
        `required questions without an answer: ${missing.map((field) => field.label).join("; ")}`,
        { answers, screenshotKey },
      );
    let submitted: Awaited<ReturnType<typeof ctx.browser.apply>>;
    try {
      submitted = await ctx.browser.apply(request("submit", answers));
    } catch (error) {
      // The form may have gone through before the answer was lost: a retry
      // could apply twice, so a person checks the inbox first.
      if (error instanceof PortError)
        return needsHuman(
          `submit outcome unknown (${error.code}): check the inbox before sending again`,
          { answers, screenshotKey },
        );
      throw error;
    }
    const finalKey =
      (await keep(submitted.screenshotBase64, "sent")) ?? screenshotKey;
    if (submitted.status === "submitted")
      return ok({
        status: "submitted",
        answers,
        confirmation: submitted.confirmation,
        screenshotKey: finalKey,
      });
    if (submitted.status === "failed")
      return fail(
        "submit_failed",
        submitted.reason ?? "the form was not accepted",
        { answers, screenshotKey: finalKey },
      );
    return needsHuman(submitted.reason ?? "the form needs a person", {
      answers,
      unanswered: submitted.unanswered,
      screenshotKey: finalKey,
    });
  },
};
