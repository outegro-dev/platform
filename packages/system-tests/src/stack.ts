import { type ChildProcess, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  RabbitMQContainer,
  type StartedRabbitMQContainer,
} from "@testcontainers/rabbitmq";
import { ValkeyContainer } from "@testcontainers/valkey";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { FakeLava } from "./fake-lava.js";
import { TcpProxy } from "./proxy.js";

/**
 * The platform's four backends as built (`dist/main.js`, the files the
 * images run), on real PostgreSQL, Valkey, RabbitMQ and an SMTP catcher,
 * with Lava replaced by FakeLava. Each service gets the variables of its
 * `.env.example`, local addresses swapped for the containers' ports and
 * secrets generated for this run.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
type Service = "auth" | "notifications" | "payments" | "battleship";
const dirs: Record<Service, string> = {
  auth: "apps/auth-backend",
  notifications: "apps/notifications-backend",
  payments: "apps/payments-backend",
  battleship: "apps/battleship-backend",
};
const examplePorts: Record<Service, number> = {
  auth: 4001,
  notifications: 4002,
  payments: 4003,
  battleship: 4004,
};

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });

const exampleOf = (service: Service) =>
  Object.fromEntries(
    readFileSync(join(root, dirs[service], ".env.example"), "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        const key = line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1];
        return key ? [[key, line.slice(key.length + 1)]] : [];
      }),
  );

export type Stack = Awaited<ReturnType<typeof startStack>>;

export async function startStack() {
  const [postgres, valkey, rabbit, mail] = await Promise.all([
    new PostgreSqlContainer("postgres:18.6-alpine")
      .withCopyFilesToContainer([
        {
          source: join(root, "infra/local/postgres/init.sql"),
          target: "/docker-entrypoint-initdb.d/init.sql",
        },
      ])
      .start(),
    new ValkeyContainer("valkey/valkey:9.1-alpine").start(),
    new RabbitMQContainer("rabbitmq:4.3-alpine").start(),
    new GenericContainer("axllent/mailpit:latest")
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forListeningPorts())
      .start(),
  ]);
  // Services reach the broker and SMTP through proxies a test can cut.
  const broker = new TcpProxy(rabbit.getHost(), rabbit.getMappedPort(5672));
  const smtp = new TcpProxy(mail.getHost(), mail.getMappedPort(1025));
  await broker.up();
  await smtp.up();
  const amqp = new URL((rabbit as StartedRabbitMQContainer).getAmqpUrl());
  amqp.hostname = "127.0.0.1";
  amqp.port = String(broker.port);
  const lava = new FakeLava();
  const secret = () => randomBytes(32).toString("base64url");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const secrets = {
    JWT_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    LOGIN_CODE_PEPPER: secret(),
    INTERNAL_API_TOKEN: secret(),
    LAVA_WEBHOOK_SECRET: secret(),
  };
  const lavaApiKey = secret();
  await lava.start(lavaApiKey);

  const ports = {
    auth: await freePort(),
    notifications: await freePort(),
    payments: await freePort(),
    battleship: await freePort(),
  };
  const url = (service: Service) => `http://127.0.0.1:${ports[service]}`;
  const pgHost = `${postgres.getHost()}:${postgres.getPort()}`;
  const mailHttp = `http://${mail.getHost()}:${mail.getMappedPort(8025)}`;

  const envOf = async (service: Service): Promise<Record<string, string>> => {
    const env: Record<string, string> = {};
    for (const [key, raw] of Object.entries(exampleOf(service))) {
      let value = raw;
      for (const [other, port] of Object.entries(examplePorts))
        value = value.replaceAll(
          `http://localhost:${port}`,
          url(other as Service),
        );
      value = value
        .replace(/@localhost:5432\//, `@${pgHost}/`)
        .replace("redis://localhost:6379", valkey.getConnectionUrl())
        .replace("amqp://outegro:outegro@localhost:5672", amqp.href)
        .replace("smtp://localhost:1025", `smtp://127.0.0.1:${smtp.port}`);
      env[key] = value;
    }
    Object.assign(env, secrets, {
      NODE_ENV: "development",
      LOG_LEVEL: "warn",
      PORT: String(ports[service]),
      METRICS_PORT: String(await freePort()),
    });
    if (service === "payments")
      Object.assign(env, {
        CHECKOUT_ENABLED: "true",
        LAVA_API_URL: lava.url,
        LAVA_API_KEY: lavaApiKey,
        LAVA_PAYMENT_URL_HOSTS: "app.lava.top",
      });
    return env;
  };

  // A temporary working directory: a developer's own .env never leaks in.
  const cwd = mkdtempSync(join(tmpdir(), "outegro-system-"));
  const run = (
    service: Service,
    script: string,
    env: Record<string, string>,
    args: string[] = [],
  ) =>
    spawn(
      process.execPath,
      [join(root, dirs[service], "dist", script), ...args],
      {
        cwd,
        env: { PATH: process.env.PATH ?? "", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  const logs: Record<Service, string[]> = {
    auth: [],
    notifications: [],
    payments: [],
    battleship: [],
  };
  const processes = new Map<Service, ChildProcess>();
  const envs = {} as Record<Service, Record<string, string>>;

  for (const service of Object.keys(dirs) as Service[]) {
    envs[service] = await envOf(service);
    const migrate = run(service, "db/migrate.js", envs[service]);
    const code = await new Promise<number | null>((resolve) =>
      migrate.on("exit", resolve),
    );
    if (code !== 0) throw new Error(`${service} migrations failed`);
  }

  const startService = async (
    service: Service,
    extra: Record<string, string> = {},
  ) => {
    const child = run(service, "main.js", { ...envs[service], ...extra });
    const keep = (chunk: Buffer) => {
      logs[service].push(chunk.toString());
      if (logs[service].length > 400) logs[service].shift();
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    processes.set(service, child);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error(
          `${service} exited: ${logs[service].join("").slice(-2000)}`,
        );
      const ok = await fetch(`${url(service)}/health`)
        .then((res) => res.ok)
        .catch(() => false);
      if (ok) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`${service} did not become healthy`);
  };
  // Notifications first: Identity sends sign-in codes through it.
  await startService("notifications");
  await startService("auth");
  await startService("payments");
  await startService("battleship");

  return {
    url,
    lava,
    /** Stops a service and starts it again, with extra variables (SAFE_MODE). */
    async restart(service: Service, extra: Record<string, string> = {}) {
      const child = processes.get(service);
      if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        await exited;
      }
      await startService(service, extra);
    },
    broker,
    smtp,
    secrets,
    logs,
    mailHttp,
    postgres: postgres as StartedPostgreSqlContainer,
    rabbit: rabbit as StartedRabbitMQContainer,
    mail: mail as StartedTestContainer,
    /** The operator CLI: makes an existing account an owner. */
    async grantOwner(email: string) {
      const cli = run("auth", "cli/grant-owner.js", envs.auth, [
        "--email",
        email,
        "--reason",
        "system test operator",
      ]);
      const code = await new Promise<number | null>((resolve) =>
        cli.on("exit", resolve),
      );
      if (code !== 0) throw new Error("grant-owner failed");
    },
    /** SQL as a service's own role, read-only use in assertions. */
    async query(service: Service, sql: string) {
      const db = service === "auth" ? "auth" : service;
      const result = await postgres.exec([
        "psql",
        "-U",
        db,
        "-d",
        db,
        "-tAc",
        sql,
      ]);
      if (result.exitCode !== 0) throw new Error(result.output);
      return result.output.trim();
    },
    async stop() {
      for (const child of processes.values()) child.kill("SIGTERM");
      await lava.stop();
      await broker.down();
      await smtp.down();
      await Promise.all([postgres, valkey, rabbit, mail].map((c) => c.stop()));
    },
  };
}
