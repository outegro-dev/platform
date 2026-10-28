/*
 * Spellings of one technology (React / React.js / ReactJS) and the kind of
 * skill row it belongs to. Shared by the skills rows, the CV title, the ATS
 * check and the PDF keywords. A technology the dictionary does not know still
 * works everywhere: it is its own only spelling.
 */

export type TechnologyKind =
  | "language"
  | "frontend"
  | "mobile"
  | "backend"
  | "data"
  | "cloud"
  | "ai"
  | "testing"
  | "tools";

/** The first spelling of a group is the base one. */
const dictionary: Array<[TechnologyKind, string[]]> = [
  ["language", ["TypeScript", "TS"]],
  ["language", ["JavaScript", "JS", "ECMAScript"]],
  ["language", ["Python"]],
  ["language", ["Golang", "Go"]],
  ["language", ["Java"]],
  ["language", ["Kotlin"]],
  ["language", ["Swift"]],
  ["language", ["Rust"]],
  ["language", ["PHP"]],
  ["language", ["Ruby"]],
  ["language", ["C#", "C Sharp"]],
  ["language", ["C++", "CPP"]],
  ["language", ["Scala"]],
  ["language", ["Elixir"]],
  ["language", ["SQL"]],
  ["frontend", ["React", "React.js", "ReactJS"]],
  ["frontend", ["Next.js", "NextJS"]],
  ["frontend", ["Vue", "Vue.js", "VueJS"]],
  ["frontend", ["Nuxt", "Nuxt.js", "NuxtJS"]],
  ["frontend", ["Angular"]],
  ["frontend", ["Svelte"]],
  ["frontend", ["SvelteKit"]],
  ["frontend", ["Remix"]],
  ["frontend", ["HTML5/CSS3", "HTML", "CSS", "HTML5", "CSS3"]],
  ["frontend", ["Tailwind CSS", "Tailwind", "TailwindCSS"]],
  ["frontend", ["Redux Toolkit", "Redux", "RTK"]],
  ["frontend", ["TanStack Query", "React Query"]],
  ["frontend", ["MobX"]],
  ["frontend", ["Zustand"]],
  ["frontend", ["Apollo Client"]],
  ["frontend", ["Material UI", "MUI"]],
  ["frontend", ["styled-components", "Styled Components"]],
  ["frontend", ["Storybook"]],
  ["frontend", ["Webpack"]],
  ["frontend", ["Vite"]],
  ["frontend", ["WebRTC"]],
  ["frontend", ["Three.js", "ThreeJS"]],
  ["frontend", ["D3.js", "D3"]],
  ["frontend", ["Figma"]],
  ["mobile", ["React Native"]],
  ["mobile", ["Expo"]],
  ["mobile", ["Flutter"]],
  ["mobile", ["iOS"]],
  ["mobile", ["Android"]],
  ["backend", ["Node.js", "NodeJS", "Node"]],
  ["backend", ["NestJS", "Nest.js", "Nest"]],
  ["backend", ["Express", "Express.js", "ExpressJS"]],
  ["backend", ["Fastify"]],
  ["backend", ["Deno"]],
  ["backend", ["Bun"]],
  ["backend", ["Django"]],
  ["backend", ["FastAPI"]],
  ["backend", ["Flask"]],
  ["backend", ["Spring", "Spring Boot"]],
  ["backend", ["Laravel"]],
  ["backend", ["Ruby on Rails", "Rails", "RoR"]],
  ["backend", [".NET", "dotnet", ".NET Core"]],
  ["backend", ["REST", "REST API", "REST APIs", "RESTful", "RESTful APIs"]],
  ["backend", ["GraphQL"]],
  ["backend", ["gRPC"]],
  ["backend", ["tRPC"]],
  ["backend", ["WebSockets", "WebSocket"]],
  ["backend", ["Webhooks", "Webhook"]],
  ["backend", ["Microservices", "Microservice Architecture"]],
  ["backend", ["Event-Driven Architecture", "Event-Driven", "EDA"]],
  ["backend", ["OAuth", "OAuth2", "OAuth 2.0"]],
  ["backend", ["JWT", "JSON Web Tokens"]],
  ["backend", ["Stripe"]],
  ["backend", ["Prisma"]],
  ["backend", ["TypeORM"]],
  ["backend", ["Drizzle", "Drizzle ORM"]],
  ["data", ["PostgreSQL", "Postgres"]],
  ["data", ["MySQL"]],
  ["data", ["MariaDB"]],
  ["data", ["SQLite"]],
  ["data", ["MongoDB", "Mongo"]],
  ["data", ["Redis"]],
  ["data", ["Valkey"]],
  ["data", ["RabbitMQ"]],
  ["data", ["Kafka", "Apache Kafka"]],
  ["data", ["NATS"]],
  ["data", ["SQS", "AWS SQS", "Amazon SQS"]],
  ["data", ["SNS", "AWS SNS"]],
  ["data", ["Elasticsearch", "Elastic"]],
  ["data", ["OpenSearch"]],
  ["data", ["ClickHouse"]],
  ["data", ["DynamoDB"]],
  ["data", ["Cassandra"]],
  ["data", ["BigQuery"]],
  ["data", ["Snowflake"]],
  ["data", ["Supabase"]],
  ["data", ["Firebase"]],
  ["data", ["Vector Databases", "Vector Database", "Vector DB"]],
  ["data", ["pgvector"]],
  ["data", ["Pinecone"]],
  ["cloud", ["Docker"]],
  ["cloud", ["Docker Compose"]],
  ["cloud", ["Kubernetes", "K8s"]],
  ["cloud", ["Helm"]],
  ["cloud", ["Terraform"]],
  ["cloud", ["Pulumi"]],
  ["cloud", ["Ansible"]],
  ["cloud", ["AWS", "Amazon Web Services"]],
  ["cloud", ["GCP", "Google Cloud", "Google Cloud Platform"]],
  ["cloud", ["Azure", "Microsoft Azure"]],
  ["cloud", ["Cloudflare"]],
  ["cloud", ["Vercel"]],
  ["cloud", ["S3", "AWS S3", "Amazon S3"]],
  ["cloud", ["AWS Lambda", "Lambda"]],
  ["cloud", ["Serverless"]],
  ["cloud", ["CI/CD", "CICD"]],
  ["cloud", ["GitHub Actions", "GH Actions"]],
  ["cloud", ["GitLab CI/CD", "GitLab CI"]],
  ["cloud", ["Jenkins"]],
  ["cloud", ["Argo CD", "ArgoCD"]],
  ["cloud", ["Nginx"]],
  ["cloud", ["Linux"]],
  ["cloud", ["Sentry"]],
  ["cloud", ["Prometheus"]],
  ["cloud", ["Grafana"]],
  ["cloud", ["Datadog"]],
  ["cloud", ["OpenTelemetry", "OTel"]],
  ["cloud", ["New Relic"]],
  ["ai", ["LLM Inference"]],
  ["ai", ["Self-hosted LLMs", "LLMs", "LLM"]],
  ["ai", ["RAG", "Retrieval-Augmented Generation"]],
  ["ai", ["MCP", "Model Context Protocol"]],
  ["ai", ["Tool Calling", "Function Calling"]],
  ["ai", ["AI Agents", "Agent Workflows"]],
  ["ai", ["Prompt Engineering"]],
  ["ai", ["Embeddings"]],
  ["ai", ["OpenAI API", "OpenAI"]],
  ["ai", ["Anthropic API", "Claude API"]],
  ["ai", ["LangChain"]],
  ["ai", ["LlamaIndex"]],
  ["ai", ["Hugging Face", "HuggingFace"]],
  ["ai", ["PyTorch"]],
  ["ai", ["TensorFlow"]],
  ["testing", ["Jest"]],
  ["testing", ["Vitest"]],
  ["testing", ["Playwright"]],
  ["testing", ["Cypress"]],
  ["testing", ["Testing Library", "React Testing Library", "RTL"]],
  ["testing", ["Mocha"]],
  ["testing", ["Pytest"]],
  ["testing", ["Unit / Integration / E2E Testing", "E2E Testing"]],
  ["testing", ["TDD", "Test-Driven Development"]],
  ["testing", ["Code Review"]],
  ["tools", ["Git"]],
  ["tools", ["Claude Code"]],
  ["tools", ["Codex"]],
  ["tools", ["Cursor"]],
  ["tools", ["GitHub Copilot", "Copilot"]],
  ["tools", ["Jira"]],
  ["tools", ["Agile", "Scrum"]],
];

/** Lower case, letters, digits, `+` and `#` only: one key for every spelling. */
const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9+#]/g, "");

const groupByKey = new Map<
  string,
  { kind: TechnologyKind; spellings: string[] }
>();
for (const [kind, spellings] of dictionary)
  for (const spelling of spellings)
    if (!groupByKey.has(normalize(spelling)))
      groupByKey.set(normalize(spelling), { kind, spellings });

/**
 * One key for every spelling of a technology: the vacancy's spelling is kept
 * and the base spelling is not added twice (K8s and Kubernetes share a key).
 */
export function skillKey(value: string) {
  const key = normalize(value);
  const group = groupByKey.get(key);
  return group ? normalize(group.spellings[0] ?? key) : key;
}

/** Every spelling of a technology, the given one first. */
export function spellings(value: string) {
  const group = groupByKey.get(normalize(value));
  const all = [value, ...(group?.spellings ?? [])];
  const seen = new Set<string>();
  return all.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The skill row kind of a technology, null when the dictionary does not know it. */
export const technologyKind = (value: string): TechnologyKind | null =>
  groupByKey.get(normalize(value))?.kind ?? null;

/** Row kinds a skill row label names ("AI & Developer Tools" → ai, tools). */
export function labelKinds(label: string): TechnologyKind[] {
  const kinds: TechnologyKind[] = [];
  const add = (kind: TechnologyKind, pattern: RegExp) => {
    if (pattern.test(label)) kinds.push(kind);
  };
  add("language", /language/i);
  add("frontend", /front|\bui\b|web|client/i);
  add("mobile", /mobile|ios|android/i);
  add("backend", /back|server|\bapi/i);
  add("data", /data|database|storage|messag|queue|stream|persist/i);
  add("cloud", /cloud|devops|infra|observ|platform|\bops\b|deploy/i);
  add("ai", /\bai\b|\bml\b|llm|machine|intelligen/i);
  add("testing", /test|quality|\bqa\b/i);
  add("tools", /tool|practice|other|method|workflow/i);
  return kinds;
}
