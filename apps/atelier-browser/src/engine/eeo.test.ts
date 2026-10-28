import { describe, expect, it } from "vitest";
import { declineOption, isDeclineOption, isEeoQuestion } from "./eeo.js";

describe("EEO / demographic questions", () => {
  it("recognises demographic labels", () => {
    for (const label of [
      "Gender",
      "What is your gender identity?",
      "Race and Ethnicity",
      "Are you Hispanic/Latino?",
      "Veteran Status",
      "Disability Status",
      "What is your current age?",
      "I consider myself a member of the LGBTQ+ community.",
      "Sexual orientation",
      "Pronouns",
    ])
      expect(isEeoQuestion(label), label).toBe(true);
  });

  it("leaves legal and ordinary questions alone", () => {
    for (const label of [
      "Are you legally authorized to work in the country for which you are applying?",
      "Will you now or in the future require sponsorship for employment visa status?",
      "Are you at least 18 years of age?",
      "How did you hear about this job?",
      "Are you eligible to work in the country you are applying?",
      "Why do you want to work at Acme?",
    ])
      expect(isEeoQuestion(label), label).toBe(false);
  });

  it("recognises a question by its section heading", () => {
    expect(
      isEeoQuestion(
        "Which best describes you?",
        "Voluntary Self Identification",
      ),
    ).toBe(true);
    expect(
      isEeoQuestion(
        "Which best describes you?",
        "U.S. Equal Employment Opportunity information",
      ),
    ).toBe(true);
    expect(isEeoQuestion("Which best describes you?", "Diversity Survey")).toBe(
      true,
    );
    expect(
      isEeoQuestion("Which best describes you?", "Additional questions"),
    ).toBe(false);
  });

  it("recognises a question by its options", () => {
    expect(
      isEeoQuestion(
        "Which of the following communities do you belong to?",
        "",
        [
          "Person with disability",
          "Veteran",
          "Parent",
          "I prefer not to answer",
        ],
      ),
    ).toBe(true);
    expect(
      isEeoQuestion("Preferred working hours?", "", [
        "Morning",
        "Evening",
        "Prefer not to say",
      ]),
    ).toBe(false);
  });
});

describe("decline option", () => {
  it("knows the usual phrasings", () => {
    for (const option of [
      "I prefer not to answer",
      "Prefer not to say",
      "Decline to self-identify",
      "Decline To Self Identify",
      "I don't wish to answer",
      "I do not want to answer",
      "Choose not to disclose",
      "I choose not to disclose",
      "Rather not say",
    ])
      expect(isDeclineOption(option), option).toBe(true);
    for (const option of [
      "Male",
      "No",
      "I am not a protected veteran",
      "No, I do not have a disability",
    ])
      expect(isDeclineOption(option), option).toBe(false);
  });

  it("finds its position, or null when there is none", () => {
    expect(declineOption(["Male", "Female", "Decline to self-identify"])).toBe(
      2,
    );
    expect(
      declineOption([
        "Yes, I have a disability",
        "No, I do not have a disability and have not had one in the past",
        "I do not want to answer",
      ]),
    ).toBe(2);
    expect(declineOption(["Man", "Woman", "Non-binary"])).toBeNull();
  });
});
