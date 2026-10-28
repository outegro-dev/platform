import type { CvDocument } from "@outegro/contracts/atelier";

/**
 * Made-up people only. `alexExample` is small and full of characters TeX
 * treats as syntax; `qaTwoPager` is a realistic two-page CV for visual QA.
 */
export const alexExample: CvDocument = {
  name: "Alex Example",
  location: "Lisbon, Portugal",
  phoneDisplay: "+351 900 000 000",
  phoneDigits: "+351900000000",
  headline: "Senior Full-Stack Engineer",
  stack: "TypeScript · React · Node.js · PostgreSQL",
  links: [
    { url: "mailto:alex@example.com", text: "alex@example.com" },
    {
      url: "https://example.com/cv?lang=en&ref=a_b#top",
      text: "example.com/alex_example",
    },
    { url: "https://github.com/alex-example", text: "github.com/alex-example" },
  ],
  summary: [
    "Engineer with **8+ years** building B2B & SaaS products: 100% typed APIs, $0 incidents budget and #1 on-call rota.",
    "Ships with C# and C++ when needed; writes {curly} config, a_b snake_case, ~tilde~ and ^caret^ without fear of \\backslash.",
  ],
  skills: [
    { label: "Languages", items: ["TypeScript", "JavaScript", "SQL", "C#"] },
    { label: "Frontend", items: ["React", "Next.js", "Tailwind CSS"] },
    { label: "Backend", items: ["Node.js", "NestJS", "REST & GraphQL"] },
    { label: "Data", items: ["PostgreSQL", "Redis", "RabbitMQ"] },
  ],
  jobs: [
    {
      title: "Senior Engineer",
      company: "Northwind Labs",
      dates: "Jan 2022 – Present",
      location: "Remote",
      description: "Logistics SaaS for 2,000+ warehouses",
      bullets: [
        {
          id: "nw1",
          text: "Cut checkout latency by **40%** with a cache in front of the pricing service.",
        },
        {
          id: "nw2",
          text: "[Lead] Owned the migration of 120 cron jobs to a queue with retries and idempotency keys.",
        },
        {
          id: "nw3",
          text: "Built the café ordering demo for Zürich and São Paulo pilots.",
        },
      ],
    },
    {
      title: "Software Engineer",
      company: "Contoso",
      dates: "Mar 2019 – Dec 2021",
      location: "",
      description: "",
      bullets: [],
    },
  ],
  education: [
    {
      degree: "BSc in Computer Science",
      school: "Example University",
      dates: "",
    },
  ],
  languages: [
    { name: "English", level: "C1" },
    { name: "Portuguese", level: "Native" },
  ],
  pdf: {
    title: "Alex Example - Senior Full-Stack Engineer - CV",
    subject: "Senior Full-Stack Engineer resume: TypeScript, React & Node.js",
    keywords: ["TypeScript", "React", "Node.js", "C#"],
  },
};

const bullet = (id: string, text: string) => ({ id, text });

export const qaTwoPager: CvDocument = {
  name: "Jordan Sample",
  location: "Berlin, Germany",
  phoneDisplay: "+49 30 0000 0000",
  phoneDigits: "+4930000000000",
  headline: "Senior Full-Stack Engineer (AI/LLM)",
  stack: "TypeScript · React · Next.js · Node.js · Python · AI/LLM",
  links: [
    {
      url: "mailto:jordan.sample@example.com",
      text: "jordan.sample@example.com",
    },
    {
      url: "https://linkedin.com/in/jordan-sample",
      text: "linkedin.com/in/jordan-sample",
    },
    {
      url: "https://github.com/jordan-sample",
      text: "github.com/jordan-sample",
    },
    { url: "https://t.me/jordan_sample", text: "t.me/jordan_sample" },
  ],
  summary: [
    "Senior Full-Stack Engineer with **9+ years of commercial experience** building e-commerce, SaaS and internal platforms with TypeScript, React.js, Next.js, Node.js, NestJS, Python and PostgreSQL. Strongest where product ownership meets technical depth: new products, legacy modernization and reliable integrations.",
    "**Tech lead** at Fabrikam: turns ambiguous requirements into epics and architecture, then into production releases, and leads code review. Builds LLM features and agents with retrieval, tool calling and evaluation, keeping architecture and tricky bugs hands-on.",
  ],
  skills: [
    {
      label: "Programming Languages",
      items: ["TypeScript", "JavaScript", "Python", "SQL", "Go"],
    },
    {
      label: "Frontend",
      items: [
        "React",
        "Next.js",
        "Vue.js",
        "Redux Toolkit",
        "TanStack Query",
        "Tailwind CSS",
        "HTML5",
        "CSS3",
      ],
    },
    {
      label: "Backend",
      items: [
        "Node.js",
        "NestJS",
        "Express.js",
        "FastAPI",
        "RESTful APIs",
        "GraphQL",
        "tRPC",
        "OAuth 2.0",
      ],
    },
    {
      label: "Architecture",
      items: [
        "System design",
        "Backend for Frontend",
        "microservices",
        "event-driven architecture",
        "idempotency",
      ],
    },
    {
      label: "Data and Messaging",
      items: [
        "PostgreSQL",
        "MySQL",
        "MongoDB",
        "Redis",
        "RabbitMQ",
        "Kafka",
        "query optimization",
      ],
    },
    {
      label: "AI and LLM",
      items: [
        "LLMs",
        "RAG",
        "AI agents",
        "MCP",
        "tool calling",
        "structured outputs",
        "evaluation",
      ],
    },
    {
      label: "Mobile",
      items: ["React Native", "Expo", "iOS and Android releases"],
    },
    {
      label: "Testing and Quality",
      items: [
        "Jest",
        "Vitest",
        "React Testing Library",
        "Playwright",
        "E2E testing",
        "accessibility",
      ],
    },
    {
      label: "DevOps and Cloud",
      items: [
        "Docker",
        "Kubernetes",
        "Helm",
        "GitHub Actions",
        "AWS",
        "GCP",
        "Sentry",
        "Grafana",
      ],
    },
    {
      label: "Domains",
      items: [
        "E-commerce",
        "payments (Stripe)",
        "CRM",
        "B2B SaaS",
        "A/B testing",
        "SEO",
      ],
    },
  ],
  jobs: [
    {
      title: "AI Full-Stack Engineer (Part-time)",
      company: "Tailspin",
      dates: "Apr 2025 – Present",
      location: "Remote",
      description: "Applied LLM products, agentic workflows and GPU inference",
      bullets: [
        bullet(
          "t1",
          "Built an **assistant SaaS** end to end for **3,000+ monthly users**, from the React.js web app and Node API to a self-hosted open-source model with streaming answers.",
        ),
        bullet(
          "t2",
          "Architected an **agentic workflow platform**: multi-step reasoning, MCP integrations with internal systems and human approvals at the steps where mistakes are costly.",
        ),
        bullet(
          "t3",
          "Ran GPU inference with a **pool of up to 8 instances**, health checks, routing and failover, holding **99.5% availability** on rented hardware without uptime guarantees.",
        ),
        bullet(
          "t4",
          "Built a **retrieval-augmented generation system** for policy documents: embeddings in a vector database, source-passage retrieval and attribution for reviewers.",
        ),
        bullet(
          "t5",
          "Added a guard model that strips prompt injection before the main model runs, and validated every output against a JSON schema.",
        ),
      ],
    },
    {
      title: "Full-Stack Engineer, Tech Lead",
      company: "Fabrikam",
      dates: "Mar 2022 – Present",
      location: "Remote",
      description:
        "High-traffic e-commerce platform with 1 million+ monthly users",
      bullets: [
        bullet(
          "f1",
          "Lead a team of full-stack developers as **tech lead**: turn business requirements into epics, design new services and run cross-team code review.",
        ),
        bullet(
          "f2",
          "Launched a **B2B ordering platform for three subsidiaries**: a shared Next.js core with per-company layers, a NestJS BFF and an admin for bulk price and stock editing; it **paid back in about 3 months**.",
        ),
        bullet(
          "f3",
          "Consolidated three admin panels into **one operations platform** with shared workflows and API boundaries, cutting onboarding from **3 weeks to 1 week**.",
        ),
        bullet(
          "f4",
          "Raised **mobile Lighthouse Performance from 52 to 91** on customer-facing pages, cutting the main bundle from 2.2 MB to 800 KB with code splitting and deferred scripts.",
        ),
        bullet(
          "f5",
          "Extended a **Stripe-based payment service** with a QR payment method: asynchronous confirmation, webhook handling and idempotent processing.",
        ),
        bullet(
          "f6",
          "Redesigned third-party event processing with **RabbitMQ, idempotency keys and state in Postgres**, so duplicate callbacks never repeat a business operation.",
        ),
        bullet(
          "f7",
          "Developed **Python (FastAPI) services** alongside NestJS ones, including an image pipeline with signed uploads, validation and background jobs.",
        ),
        bullet(
          "f8",
          "Built an **SEO content service for 10,000+ product pages** that marketing runs without engineering support.",
        ),
        bullet(
          "f9",
          "Debugged **production incidents** across client, BFF, services and providers with Sentry and Grafana, and shipped root-cause fixes.",
        ),
        bullet(
          "f10",
          "Instrumented **A/B tests and analytics funnels** across 1 million+ sessions, showing the product team where users dropped off.",
        ),
      ],
    },
    {
      title: "Software Engineer",
      company: "Wingtip",
      dates: "Feb 2020 – Feb 2022",
      location: "Remote",
      description:
        "CRM platform for small businesses: messaging and lead notifications",
      bullets: [
        bullet(
          "w1",
          "Unified **Telegram and WhatsApp provider modules** behind a shared contract for payloads, delivery status, retries and errors.",
        ),
        bullet(
          "w2",
          "Redesigned lead-notification setup with clearer form states and inline feedback, cutting configuration time from **over 30 minutes to under 5**.",
        ),
        bullet(
          "w3",
          "Fixed **out-of-order messaging webhooks** with event versions and idempotent updates, so late callbacks never overwrite newer state.",
        ),
        bullet(
          "w4",
          "Resolved race conditions in the **real-time messaging UI** (React, WebSockets) with explicit operation states.",
        ),
        bullet(
          "w5",
          "Built **resumable CRM imports** with staged validation, batch processing and row-level error reports.",
        ),
      ],
    },
    {
      title: "Full-Stack Engineer",
      company: "Litware",
      dates: "Jan 2018 – Jan 2020",
      location: "Remote",
      description:
        "E-commerce fulfillment platform: checkout, shipping and admin flows",
      bullets: [
        bullet(
          "l1",
          "Designed a **Node.js checkout BFF** that aggregated cart, pricing and shipping data from seven services, cutting client calls to **two per session**.",
        ),
        bullet(
          "l2",
          "Built a **provider-agnostic shipping service** that normalized carrier rates and isolated checkout with timeouts and circuit breakers.",
        ),
        bullet(
          "l3",
          "Introduced shared **TypeScript contracts with runtime schema validation**, catching incompatible payloads at service boundaries.",
        ),
      ],
    },
    {
      title: "Web Developer",
      company: "Proseware",
      dates: "Jun 2016 – Dec 2017",
      location: "Berlin",
      description:
        "Web development for a repair company: landing pages and internal tools",
      bullets: [
        bullet(
          "p1",
          "Developed **responsive landing pages** with lead forms, analytics and regular content updates.",
        ),
        bullet(
          "p2",
          "Extended an **internal technician forum** with forms and backend integration for repair notes.",
        ),
      ],
    },
  ],
  education: [
    {
      degree: "Bachelor's Degree in Computer Science",
      school: "Example Technical University",
      dates: "Sep 2012 – Jun 2016",
    },
  ],
  languages: [
    { name: "English", level: "C1, Full Professional Proficiency" },
    { name: "German", level: "B2" },
    { name: "Spanish", level: "Native" },
  ],
  pdf: {
    title: "Jordan Sample - Senior Full-Stack Engineer (AI/LLM) - CV",
    subject:
      "Senior Full-Stack Engineer resume: TypeScript, React.js, Next.js, Node.js, Python",
    keywords: [
      "Senior Full-Stack Engineer",
      "TypeScript",
      "React",
      "Next.js",
      "Node.js",
      "NestJS",
      "Python",
      "PostgreSQL",
      "LLM",
      "RAG",
    ],
  },
};
