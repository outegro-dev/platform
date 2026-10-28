import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  llmErrorSchema,
  llmGenerateResponseSchema,
  llmProfileSchema,
  llmProviderStatusSchema,
} from "@outegro/contracts/atelier";
import { CLOCK, ManualClock, Metrics } from "@outegro/nest-common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LlmFailure } from "./domain/failures.js";
import { LLM_PROVIDERS } from "./providers/provider.js";
import { blocked, FakeProvider } from "./test/fake-provider.js";

const TOKEN = "test-token-0123456789-0123456789-abcdef";
const auth = { authorization: `Bearer ${TOKEN}` };
const okSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
const body = (overrides: Record<string, unknown> = {}) => ({
  profile: "codex-sol-low",
  purpose: "test.ping",
  system: "Answer as JSON.",
  input: "Is it ok?",
  schema: okSchema,
  requestId: "job_1:ping:1",
  ...overrides,
});

const codex = new FakeProvider("codex");
const claude = new FakeProvider("claude");
const minimax = new FakeProvider("minimax");
const clock = new ManualClock(new Date("2026-10-28T03:00:00Z"));
let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication["getHttpServer"]>;

const generate = (payload: unknown = body()) =>
  request(http)
    .post("/v1/generate")
    .set(auth)
    .send(payload as object);

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "4009",
    METRICS_PORT: "0",
    LOG_LEVEL: "fatal",
    LLM_GATEWAY_TOKEN: TOKEN,
    LLM_QUEUE_TIMEOUT_MS: "1000",
    LLM_QUOTA_PAUSE_SECONDS: "3600",
    LLM_ACCOUNT: "owner",
  });
  delete process.env.LLM_PROFILES_PATH;
  const { env } = await import("./config/env.js");
  env.reset();
  const { AppModule } = await import("./app.module.js");
  const { setupApp } = await import("./app.js");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PROVIDERS)
    .useValue([codex, claude, minimax])
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  setupApp(app);
  await app.init();
  http = app.getHttpServer();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  for (const provider of [codex, claude, minimax]) provider.reset();
  // No pause left over from another test.
  for (const id of ["codex", "claude", "minimax"])
    await request(http).delete(`/v1/providers/${id}/pause`).set(auth);
});

describe("auth and listings", () => {
  it("serves /health without a token and nothing else", async () => {
    await request(http).get("/health").expect(200);
    await request(http).get("/v1/profiles").expect(401);
    await request(http)
      .get("/v1/profiles")
      .set({ authorization: `Bearer ${"x".repeat(TOKEN.length)}` })
      .expect(401);
    await request(http).post("/v1/generate").send(body()).expect(401);
    expect(codex.calls).toHaveLength(0);
  });

  it("lists the profiles and the providers", async () => {
    const profiles = await request(http)
      .get("/v1/profiles")
      .set(auth)
      .expect(200);
    expect(profiles.body.map((item: { id: string }) => item.id)).toEqual([
      "codex-sol-low",
      "codex-sol-medium",
      "codex-luna-medium",
      "claude-sonnet-low",
      "claude-opus-medium",
      "claude-haiku-medium",
      "minimax-m3.1-flash-low",
    ]);
    for (const profile of profiles.body) llmProfileSchema.parse(profile);
    expect(profiles.body[0]).toEqual({
      id: "codex-sol-low",
      label: "Codex · GPT-6 Sol · low",
      provider: "codex",
      model: "gpt-6-sol",
      reasoningEffort: "low",
    });
    claude.unavailable = "CLAUDE_CODE_OAUTH_TOKEN is not set";
    const providers = await request(http)
      .get("/v1/providers")
      .set(auth)
      .expect(200);
    for (const status of providers.body) llmProviderStatusSchema.parse(status);
    expect(providers.body).toEqual([
      {
        id: "codex",
        available: true,
        reason: null,
        pausedUntil: null,
        concurrency: 3,
        inFlight: 0,
      },
      {
        id: "claude",
        available: false,
        reason: "CLAUDE_CODE_OAUTH_TOKEN is not set",
        pausedUntil: null,
        concurrency: 3,
        inFlight: 0,
      },
      expect.objectContaining({ id: "minimax", available: true }),
    ]);
    await request(http)
      .delete("/v1/providers/nope/pause")
      .set(auth)
      .expect(404);
  });
});

describe("POST /v1/generate", () => {
  it("answers with the provider's checked output", async () => {
    const res = await generate().expect(200);
    expect(llmGenerateResponseSchema.parse(res.body)).toEqual({
      output: { ok: true },
      provider: "codex",
      model: "gpt-6-sol",
      usage: { input: 10, output: 2 },
      ms: expect.any(Number),
    });
    const [call] = codex.calls;
    expect(call).toMatchObject({
      system: "Answer as JSON.",
      input: "Is it ok?",
      schema: okSchema,
      timeoutMs: 900_000,
      profile: {
        id: "codex-sol-low",
        model: "gpt-6-sol",
        reasoningEffort: "low",
      },
    });
    await generate(body({ timeoutMs: 60_000 })).expect(200);
    expect(codex.calls[1]?.timeoutMs).toBe(60_000);
  });

  it("refuses a bad request with an LlmError", async () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ ...body(), schema: undefined }, /schema/],
      [body({ timeoutMs: 5 }), /timeoutMs/],
      [body({ profile: "gpt-unknown" }), /Unknown profile/],
      [body({ account: "someone-else" }), /Unknown account/],
      [body({ schema: { $ref: "#/$defs/missing" } }), /Unusable schema/],
    ];
    for (const [payload, message] of cases) {
      const res = await generate(payload).expect(400);
      expect(llmErrorSchema.parse(res.body)).toMatchObject({
        error: "bad_request",
        retryable: false,
        resetsAt: null,
      });
      expect(res.body.message).toMatch(message);
    }
    const broken = await request(http)
      .post("/v1/generate")
      .set({ ...auth, "content-type": "application/json" })
      .send('{"profile": ')
      .expect(400);
    expect(broken.body).toMatchObject({ error: "bad_request" });
    expect(codex.calls).toHaveLength(0);
  });

  it("takes a vacancy-sized input", async () => {
    await generate(body({ input: "й".repeat(590_000) })).expect(200);
    expect(codex.calls[0]?.input).toHaveLength(590_000);
  });

  it("sends schema errors back once, then gives up with 422", async () => {
    codex.queue(
      (call) => ({
        output: { ok: "yes" },
        model: call.profile.model,
        inputTokens: 100,
        outputTokens: 7,
      }),
      (call) => ({
        output: { ok: false },
        model: call.profile.model,
        inputTokens: 120,
        outputTokens: 5,
      }),
    );
    const fixed = await generate().expect(200);
    expect(fixed.body).toMatchObject({
      output: { ok: false },
      usage: { input: 220, output: 12 },
    });
    expect(codex.calls[1]?.correction).toEqual({
      output: { ok: "yes" },
      errors: ["ok: expected boolean, got string"],
      transcript: undefined,
    });

    codex.reset();
    codex.queue(
      (call) => ({
        output: {},
        model: call.profile.model,
        inputTokens: null,
        outputTokens: null,
      }),
      (call) => ({
        output: { ok: 1 },
        model: call.profile.model,
        inputTokens: null,
        outputTokens: null,
      }),
    );
    const failed = await generate().expect(422);
    expect(llmErrorSchema.parse(failed.body)).toMatchObject({
      error: "invalid_output",
      retryable: false,
    });
    expect(failed.body.message).toContain("ok: expected boolean, got number");
    expect(codex.calls).toHaveLength(2);
  });

  it("maps provider failures to 503 and 504", async () => {
    claude.unavailable = "CLAUDE_CODE_OAUTH_TOKEN is not set";
    const missing = await generate(
      body({ profile: "claude-sonnet-low" }),
    ).expect(503);
    expect(missing.body).toMatchObject({
      error: "provider_unavailable",
      retryable: false,
    });
    expect(claude.calls).toHaveLength(0);

    codex.queue(() => {
      throw new LlmFailure("provider_timeout", "Codex did not finish in 900 s");
    });
    const slow = await generate().expect(504);
    expect(slow.body).toMatchObject({
      error: "provider_timeout",
      retryable: true,
    });

    codex.queue(() => {
      throw new Error("stream disconnected before completion");
    });
    const flaky = await generate().expect(503);
    expect(flaky.body).toMatchObject({
      error: "provider_unavailable",
      retryable: true,
    });

    codex.queue(() => {
      throw new Error("401 Unauthorized: refresh token was already used");
    });
    const login = await generate().expect(503);
    expect(login.body).toMatchObject({
      error: "provider_unavailable",
      retryable: false,
    });
  });
});

describe("limits", () => {
  it("pauses a provider until the reset it names, then lets it go", async () => {
    codex.queue(() => {
      throw new Error("You've hit your usage limit. Try again at 5:03 AM.");
    });
    const limited = await generate().expect(429);
    expect(llmErrorSchema.parse(limited.body)).toMatchObject({
      error: "provider_quota",
      retryable: false,
      resetsAt: "2026-10-28T05:04:00.000Z",
    });
    // Refused at once, without asking the provider; other profiles of the provider too.
    const again = await generate(body({ profile: "codex-luna-medium" })).expect(
      429,
    );
    expect(again.body.resetsAt).toBe("2026-10-28T05:04:00.000Z");
    expect(codex.calls).toHaveLength(1);
    // Another provider is not affected.
    await generate(body({ profile: "minimax-m3.1-flash-low" })).expect(200);

    const status = await request(http)
      .get("/v1/providers")
      .set(auth)
      .expect(200);
    expect(status.body[0]).toMatchObject({
      id: "codex",
      available: false,
      pausedUntil: "2026-10-28T05:04:00.000Z",
    });
    const lifted = await request(http)
      .delete("/v1/providers/codex/pause")
      .set(auth)
      .expect(200);
    expect(lifted.body).toMatchObject({
      id: "codex",
      available: true,
      pausedUntil: null,
    });
    await generate().expect(200);
  });

  it("lifts a pause by itself once the reset has passed", async () => {
    codex.queue(() => {
      throw new Error("429 Too Many Requests");
    });
    const limited = await generate().expect(429);
    expect(limited.body.resetsAt).toBe(
      new Date(clock.now().getTime() + 3600_000).toISOString(),
    );
    clock.advance(3600_000);
    await generate().expect(200);
  });

  it("queues past the provider's concurrency, gives up after the longest wait", async () => {
    const gates = [blocked(), blocked(), blocked()];
    codex.queue(...gates.map((gate) => gate.step));
    const running = gates.map(() => generate());
    const sent = running.map((test) => test.then((res) => res));
    await waitFor(() => codex.calls.length === 3);
    const status = await request(http)
      .get("/v1/providers")
      .set(auth)
      .expect(200);
    expect(status.body[0]).toMatchObject({
      id: "codex",
      inFlight: 3,
      concurrency: 3,
    });
    const waited = await generate().expect(503);
    expect(waited.body).toMatchObject({
      error: "provider_unavailable",
      retryable: true,
    });
    expect(waited.body.message).toMatch(/Timed out waiting/);
    for (const gate of gates) gate.release();
    for (const res of await Promise.all(sent)) expect(res.status).toBe(200);
  });

  it("refuses the queue when a running call hits the limit", async () => {
    let fail!: () => void;
    const quota = new Promise<void>((resolve) => {
      fail = resolve;
    });
    const gates = [blocked(), blocked()];
    codex.queue(
      async () => {
        await quota;
        throw new Error("You've hit your usage limit. Try again at 5:03 AM.");
      },
      ...gates.map((gate) => gate.step),
    );
    const running = [generate(), generate(), generate()].map((test) =>
      test.then((res) => res),
    );
    await waitFor(() => codex.calls.length === 3);
    const queued = generate().then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 50));
    fail();
    const refused = await queued;
    expect(refused.status).toBe(429);
    expect(refused.body.resetsAt).toBe("2026-10-28T05:04:00.000Z");
    for (const gate of gates) gate.release();
    expect(
      (await Promise.all(running)).map((res) => res.status).sort(),
    ).toEqual([200, 200, 429]);
    expect(codex.calls).toHaveLength(3);
  });

  it("stops the provider run when the caller hangs up", async () => {
    const gate = blocked();
    codex.queue(gate.step);
    await expect(generate().timeout(300)).rejects.toThrow();
    await waitFor(() => codex.calls[0]?.signal.aborted === true);
    const status = await request(http)
      .get("/v1/providers")
      .set(auth)
      .expect(200);
    expect(status.body[0]).toMatchObject({ inFlight: 0 });
  });
});

describe("metrics", () => {
  it("counts generations, tokens and corrections by provider and outcome", async () => {
    await generate().expect(200);
    const scrape = await app.get(Metrics).scrape();
    expect(scrape).toMatch(
      /llm_gateway_generations_total\{[^}]*provider="codex"[^}]*profile="codex-sol-low"[^}]*outcome="ok"[^}]*\} \d+/,
    );
    expect(scrape).toMatch(
      /llm_gateway_tokens_total\{[^}]*provider="codex"[^}]*direction="in"[^}]*\} \d+/,
    );
    expect(scrape).toMatch(
      /llm_gateway_in_flight\{[^}]*provider="codex"[^}]*\} 0/,
    );
    expect(scrape).toContain("llm_gateway_corrections_total");
    // Labels from the profiles file only: an unknown profile is "unknown".
    await generate(body({ profile: "made-up-profile" })).expect(400);
    const after = await app.get(Metrics).scrape();
    expect(after).not.toContain("made-up-profile");
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition not met");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
