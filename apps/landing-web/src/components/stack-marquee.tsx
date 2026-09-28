import { useTranslations } from "next-intl";

const stack = [
  "TypeScript",
  "React",
  "Next.js",
  "NestJS",
  "Node.js",
  "PostgreSQL",
  "Drizzle",
  "Redis",
  "RabbitMQ",
  "ClickHouse",
  "Docker",
  "Kubernetes",
  "K3s",
  "Argo CD",
  "GitHub Actions",
  "Prometheus",
  "Grafana",
  "Three.js",
  "Tailwind CSS",
];

export function StackMarquee() {
  const t = useTranslations("stack");
  return (
    <section className="stack-marquee" aria-label={t("label")}>
      <div className="stack-track">
        <ul>
          {stack.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <ul aria-hidden="true">
          {stack.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
