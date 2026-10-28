import { describe, expect, it } from "vitest";
import { applyRequest } from "../test/request.js";
import { type DecideContext, decide } from "./decide.js";
import type { RawField, RawOption } from "./page-scripts.js";

const field = (patch: Partial<RawField>): RawField => ({
  ref: "a1",
  click: "a1",
  kind: "text",
  label: "",
  hints: "",
  placeholder: "",
  required: false,
  options: null,
  multiple: false,
  value: "",
  answered: false,
  section: "",
  readonly: false,
  listbox: null,
  ...patch,
});
const options = (...labels: string[]): RawOption[] =>
  labels.map((label, index) => ({
    ref: `o${index}`,
    click: `o${index}`,
    label,
    selected: false,
    index,
  }));

const ctx = (patch: Partial<DecideContext> = {}): DecideContext => ({
  req: applyRequest({
    ats: "lever",
    applyUrl: "https://jobs.lever.co/acme/1/apply",
  }),
  cvPath: "/tmp/cv.pdf",
  cvName: "cv.pdf",
  coverPath: null,
  coverName: null,
  fields: [],
  ...patch,
});

describe("decide", () => {
  it("checks privacy consents and leaves marketing ones", () => {
    expect(
      decide(
        field({
          kind: "checkbox",
          label:
            "I consent to the processing of my personal data (Privacy Policy)",
        }),
        ctx(),
      ),
    ).toEqual({ kind: "check", on: true });
    expect(
      decide(
        field({
          kind: "checkbox",
          label:
            "Acme has my consent to contact me about future job opportunities.",
        }),
        ctx(),
      ),
    ).toEqual({ kind: "leave" });
  });

  it("declines EEO questions and never uses the bank for them", () => {
    const gender = field({
      kind: "select",
      label: "Gender",
      options: options("Male", "Female", "Decline to self-identify"),
    });
    const withAnswer = ctx({
      req: { ...ctx().req, answers: [{ question: "Gender", answer: "Male" }] },
    });
    expect(decide(gender, withAnswer)).toEqual({
      kind: "options",
      indices: [2],
    });
    expect(
      decide(
        field({
          kind: "radio",
          label: "Gender",
          options: options("Man", "Woman"),
        }),
        ctx(),
      ),
    ).toEqual({ kind: "leave" });
  });

  it("sends the CV to the resume input, not to other file inputs", () => {
    const resume = field({ ref: "f1", kind: "file", label: "Resume/CV" });
    const transcript = field({ ref: "f2", kind: "file", label: "Transcript" });
    const fields = [transcript, resume];
    expect(decide(resume, ctx({ fields }))).toEqual({
      kind: "file",
      path: "/tmp/cv.pdf",
      name: "cv.pdf",
    });
    expect(decide(transcript, ctx({ fields }))).toBeNull();
    const attachment = field({ ref: "f3", kind: "file", label: "Attachments" });
    expect(decide(attachment, ctx({ fields: [attachment] }))).toEqual(
      expect.objectContaining({ kind: "file" }),
    );
  });

  it("puts the cover letter in a cover letter textarea, or uploads it", () => {
    const req = { ...ctx().req, coverLetter: "Dear Acme" };
    expect(
      decide(
        field({
          kind: "textarea",
          label: "Additional information",
          placeholder: "Add a cover letter or anything else",
        }),
        ctx({ req }),
      ),
    ).toEqual({ kind: "text", value: "Dear Acme" });
    expect(
      decide(
        field({ kind: "file", label: "Cover Letter" }),
        ctx({ req, coverPath: "/tmp/c.txt", coverName: "c.txt" }),
      ),
    ).toEqual({ kind: "file", path: "/tmp/c.txt", name: "c.txt" });
  });

  it("answers from the bank by kind; nothing matching means unanswered", () => {
    const req = {
      ...ctx().req,
      answers: [
        {
          question: "Are you legally authorized to work in Germany?",
          answer: "Yes",
        },
        { question: "How many years of experience do you have?", answer: "12" },
      ],
    };
    expect(
      decide(
        field({
          kind: "radio",
          label: "Are you legally authorized to work in Germany?*",
          options: options("Yes", "No"),
        }),
        ctx({ req }),
      ),
    ).toEqual({ kind: "options", indices: [0] });
    expect(
      decide(
        field({
          kind: "select",
          label: "How many years of experience do you have?",
          options: options("0-2", "3-5", "6-10", "10+"),
        }),
        ctx({ req }),
      ),
    ).toEqual({ kind: "options", indices: [3] });
    expect(
      decide(
        field({ kind: "textarea", label: "Why Acme?", required: true }),
        ctx({ req }),
      ),
    ).toBeNull();
    expect(
      decide(
        field({ label: "Why Acme?", answered: true, value: "parsed" }),
        ctx({ req }),
      ),
    ).toEqual({ kind: "keep" });
  });
});
