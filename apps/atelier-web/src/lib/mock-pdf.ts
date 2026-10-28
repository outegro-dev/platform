/*
 * A one-page CV as a real PDF for mock mode, so the Resume tab previews a
 * document without atelier-tex. Plain PDF 1.4 with the standard Helvetica
 * faces; text is ASCII only.
 */

type Line = { text: string; size: number; bold?: boolean; gap?: number };

const pdfText = (text: string) =>
  text
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

/** Splits text into lines that fit `width` points at `size` (approximate). */
function wrap(text: string, size: number, width = 495): string[] {
  const perLine = Math.floor(width / (size * 0.5));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > perLine) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

export function mockCvPdf(input: {
  name: string;
  headline: string;
  company: string;
  role: string;
}): Uint8Array {
  const lines: Line[] = [
    { text: input.name, size: 22, bold: true },
    { text: input.headline, size: 12, gap: 4 },
    {
      text: "Valencia, Spain  |  rowan.ellery@mail.example  |  cv.outegro.dev",
      size: 9,
      gap: 14,
    },
    { text: "ABOUT", size: 10, bold: true, gap: 6 },
    ...wrap(
      `Senior engineer with six years of TypeScript across the stack. Built event-driven services on PostgreSQL, a design system used by four teams and LLM features with evals. Tailored for ${input.company}, ${input.role}.`,
      10,
    ).map((text) => ({ text, size: 10 })),
    { text: "EXPERIENCE", size: 10, bold: true, gap: 16 },
    {
      text: "Copperleaf Payments  -  Senior Software Engineer  -  2022 to now",
      size: 10,
      bold: true,
      gap: 4,
    },
    ...[
      "Built a double-entry ledger for merchant payouts: 0 balance drifts in 14 months.",
      "Webhook delivery with retries and replay; failed deliveries down from 2.1% to 0.08%.",
      "Led the on-call rotation and incident reviews for six services.",
    ].flatMap((text) =>
      wrap(`-  ${text}`, 10).map((t) => ({ text: t, size: 10 })),
    ),
    {
      text: "Harbor & Vale  -  Full-Stack Engineer  -  2020 to 2022",
      size: 10,
      bold: true,
      gap: 10,
    },
    ...[
      "Rewrote the checkout in React: 18% fewer drop-offs.",
      "Design system with Radix and Tailwind, used by four product teams.",
      "Largest Contentful Paint from 3.9 s to 1.7 s on the main flows.",
    ].flatMap((text) =>
      wrap(`-  ${text}`, 10).map((t) => ({ text: t, size: 10 })),
    ),
    {
      text: "Lattice Freight  -  Software Engineer  -  2018 to 2020",
      size: 10,
      bold: true,
      gap: 10,
    },
    ...[
      "Rebuilt the order service as idempotent consumers on RabbitMQ.",
      "Cut the slowest report from 40 s to 1.2 s with partitioning and indexes.",
    ].flatMap((text) =>
      wrap(`-  ${text}`, 10).map((t) => ({ text: t, size: 10 })),
    ),
    { text: "SKILLS", size: 10, bold: true, gap: 16 },
    {
      text: "TypeScript, Node.js, NestJS, React, Next.js, PostgreSQL, Redis, RabbitMQ",
      size: 10,
    },
    {
      text: "Playwright, Kubernetes, Terraform, Grafana, LLM tooling and evals",
      size: 10,
    },
    { text: "EDUCATION", size: 10, bold: true, gap: 16 },
    {
      text: "BSc Computer Science, Universitat Politecnica (example), 2018",
      size: 10,
    },
  ];

  let y = 790;
  const ops: string[] = ["BT"];
  for (const line of lines) {
    y -= line.size + 4 + (line.gap ?? 0);
    ops.push(
      `/${line.bold ? "F2" : "F1"} ${line.size} Tf`,
      `1 0 0 1 50 ${y} Tm`,
      `(${pdfText(line.text)}) Tj`,
    );
  }
  ops.push("ET");
  // An accent rule under the name.
  ops.push("0.36 0.26 0.62 RG 1.2 w 50 742 m 545 742 l S");
  const stream = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Title (${pdfText(`${input.name}, ${input.role}`)}) /Producer (atelier-web mock) >>`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
