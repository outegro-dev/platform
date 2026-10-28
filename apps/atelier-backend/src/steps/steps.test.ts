import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/storage.js";
import {
  testAnalysis,
  testDocument,
  testFields,
  testProfile,
  vacancyText,
} from "../test/fixtures.js";
import { channelStep, sendStep, textsStep } from "./apply.steps.js";
import { extractStep } from "./catalog.steps.js";
import { atsCheckStep, storeStep } from "./resume.steps.js";
import type { StepContext, StepHandler, TaskOf } from "./step-handler.js";

const storage = new MemoryStorage();
const ctx: StepContext = {
  llm: { generate: () => Promise.reject(new Error("no model here")) },
  tex: { render: () => Promise.reject(new Error("no tex here")) },
  browser: { apply: () => Promise.reject(new Error("no browser here")) },
  storage,
  log: { info: () => undefined, warn: () => undefined },
  now: () => new Date(),
};

/** Runs a real handler on input checked by its own schema. */
function run<I>(handler: StepHandler<I>, input: unknown) {
  const task: TaskOf<I> = {
    id: randomUUID(),
    jobId: randomUUID(),
    type: handler.type,
    contract: handler.contract,
    attempt: 1,
    idempotencyKey: "test",
    userId: null,
    input: handler.input.parse(input),
    deadline: new Date(Date.now() + 60_000).toISOString(),
  };
  return handler.handle(task, ctx);
}

describe("step handlers (real engine, no services)", () => {
  it("extract makes manual fields from a pasted text", async () => {
    const outcome = await run(extractStep, {
      text: vacancyText,
      url: null,
      manualUrl: "https://atelier.outegro.dev/manual/1",
    });
    expect(outcome).toMatchObject({
      status: "ok",
      output: {
        fields: {
          provider: "manual",
          url: "https://atelier.outegro.dev/manual/1",
          title: "Senior Backend Engineer at Examplecorp",
          remote: true,
        },
      },
    });
  });

  it("channel picks the ATS form, else a contact from the text", async () => {
    expect(await run(channelStep, { fields: testFields() })).toMatchObject({
      output: { channel: "ats_form", ats: "lever" },
    });
    const mail = {
      ...testFields("https://example.com/careers/1"),
      applyUrl: null,
      ats: null,
      text: `${vacancyText}\nSend your CV to Jobs@Example.com`,
    };
    expect(await run(channelStep, { fields: mail })).toMatchObject({
      output: { channel: "email", target: "jobs@example.com" },
    });
  });

  it("ats-check measures the must terms in the CV text", async () => {
    const outcome = await run(atsCheckStep, {
      document: testDocument(),
      requirements: testAnalysis.requirements,
    });
    expect(outcome.status).toBe("ok");
    const output = (outcome as { output: { coverage: number } }).output;
    expect(output.coverage).toBeGreaterThan(0);
    expect(output.coverage).toBeLessThanOrEqual(1);
  });

  it("texts writes the Telegram message and the email from templates, without the model", async () => {
    const outcome = await run(textsStep, {
      profile: testProfile,
      analysis: testAnalysis,
      fields: testFields(),
      draft: {},
      kinds: [],
    });
    expect(outcome.status).toBe("ok");
    const { materials } = (
      outcome as { output: { materials: { kind: string; body: string }[] } }
    ).output;
    expect(materials.map((item) => item.kind)).toEqual([
      "telegram",
      "email_ru",
    ]);
    for (const item of materials) expect(item.body).not.toContain("—");
  });

  it("store refuses when the fitted files are missing, and names them when present", async () => {
    const input = {
      versionId: randomUUID(),
      pdfKey: "cv/u/a/v.pdf",
      texKey: "cv/u/a/v.tex",
      fileName: "Alex_Example_CV.pdf",
    };
    expect((await run(storeStep, input)).status).toBe("fail");
    await storage.put(input.pdfKey, Buffer.from("%PDF"), "application/pdf");
    await storage.put(input.texKey, Buffer.from("tex"), "application/x-tex");
    expect(await run(storeStep, input)).toMatchObject({
      status: "ok",
      output: { storageKey: input.pdfKey, size: 4 },
    });
  });

  it("send leaves channels other than ATS forms to a person", async () => {
    const outcome = await run(sendStep, {
      mode: "submit",
      channel: {
        channel: "email",
        target: "jobs@example.com",
        ats: null,
        applyUrl: null,
      },
      profile: testProfile,
      fields: testFields(),
      analysis: testAnalysis,
      draft: null,
      cv: { storageKey: "cv/u/a/v.pdf", fileName: "Alex_Example_CV.pdf" },
      coverLetter: null,
      answers: [],
    });
    expect(outcome).toMatchObject({ status: "needs_human" });
  });
});
