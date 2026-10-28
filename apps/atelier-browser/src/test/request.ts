import type { BrowserApplyRequest } from "@outegro/contracts/atelier";

/** A one-page PDF with made-up text, enough for any file input. */
export function dummyPdf(): Buffer {
  const content =
    "BT /F1 14 Tf 72 760 Td (Alex Example - Software Engineer) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export const CV_NAME = "Alex_Example_Software_Engineer_CV.pdf";

/** A made-up applicant ("Alex Example"); answers are added per test. */
export function applyRequest(
  overrides: Partial<BrowserApplyRequest> &
    Pick<BrowserApplyRequest, "applyUrl" | "ats">,
): BrowserApplyRequest {
  return {
    mode: "prepare",
    fields: {
      firstName: "Alex",
      lastName: "Example",
      fullName: "Alex Example",
      email: "alex@example.com",
      phone: "+44 7700 900123",
      location: "Tbilisi, Georgia",
      linkedin: "https://www.linkedin.com/in/alex-example",
      github: "https://github.com/alex-example",
      website: "https://alex.example.com",
      currentCompany: "Example Corp",
      currentTitle: "Software Engineer",
    },
    answers: [],
    cv: { fileName: CV_NAME, base64: dummyPdf().toString("base64") },
    coverLetter: null,
    ...overrides,
  };
}
