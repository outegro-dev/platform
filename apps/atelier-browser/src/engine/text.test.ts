import { describe, expect, it } from "vitest";
import {
  chooseOption,
  chooseOptions,
  cityOf,
  cleanLabel,
  countryOf,
  findAnswer,
  normalize,
  numericRange,
  optionScore,
  similarity,
  tokens,
} from "./text.js";

describe("label normalisation", () => {
  it("drops required / optional markers and trailing colons", () => {
    expect(cleanLabel("First Name*")).toBe("First Name");
    expect(cleanLabel("*  Last name ")).toBe("Last name");
    expect(cleanLabel("Resume/CV ✱")).toBe("Resume/CV");
    expect(cleanLabel("Cover letter (Optional)")).toBe("Cover letter");
    expect(cleanLabel("Phone (required):")).toBe("Phone");
    expect(cleanLabel("Why\n  Acme?\t")).toBe("Why Acme?");
  });

  it("lower-cases, strips accents and punctuation", () => {
    expect(normalize("Résumé / CV*")).toBe("resume cv");
    expect(normalize("Don't wish to answer")).toBe("dont wish to answer");
    expect(normalize("Research & Development")).toBe(
      "research and development",
    );
    expect(normalize("Location (City)")).toBe("location city");
    expect(normalize("10+ years")).toBe("10+ years");
  });

  it("keeps content words, stemmed, without instructions", () => {
    expect(tokens("Language Skill(s) (Check all that apply)")).toEqual([
      "language",
      "skill",
    ]);
    expect(tokens("How many years of experience do you have?")).toEqual([
      "many",
      "year",
      "experience",
    ]);
    // Only stopwords: keep them rather than nothing.
    expect(tokens("Are you?")).toEqual(["are", "you"]);
  });
});

describe("fuzzy question matching", () => {
  it("is 1 for the same question written differently", () => {
    expect(
      similarity(
        "Why do you want to work at Acme?",
        "why do you want to work at acme",
      ),
    ).toBe(1);
  });

  it("matches reworded questions at ≥ 0.6", () => {
    expect(
      similarity(
        "Will you require visa sponsorship to work in this location?",
        "Will you now or in the future require sponsorship for employment visa status to work in this location?",
      ),
    ).toBeGreaterThanOrEqual(0.6);
    expect(
      similarity("Notice period", "Notice period / availability"),
    ).toBeGreaterThanOrEqual(0.6);
    expect(
      similarity("Language skills", "Language Skill(s) (Check all that apply)"),
    ).toBe(1);
  });

  it("keeps unrelated questions apart", () => {
    expect(
      similarity(
        "Why do you want to work at Acme?",
        "How did you hear about this job?",
      ),
    ).toBeLessThan(0.6);
    expect(
      similarity("Expected salary", "Current salary and bonus structure"),
    ).toBeLessThan(0.6);
    expect(similarity("", "Name")).toBe(0);
  });

  it("finds the best answer above the threshold and skips empty ones", () => {
    const answers = [
      {
        question: "Are you legally authorized to work in Germany?",
        answer: "Yes",
      },
      { question: "Why do you want to work at Acme?", answer: "" },
      { question: "Why Acme?", answer: "The product." },
      { question: "Expected salary", answer: "90000 EUR" },
    ];
    expect(
      findAnswer(
        "Are you legally authorized to work in Germany for our Company?",
        answers,
      )?.answer,
    ).toBe("Yes");
    expect(findAnswer("Why do you want to work at Acme?", answers)).toBeNull();
    expect(findAnswer("How did you hear about us?", answers)).toBeNull();
    expect(
      findAnswer("Expected salary (EUR, gross per year)", answers)?.answer,
    ).toBe("90000 EUR");
  });
});

describe("option choice", () => {
  it("matches yes / no by polarity, not by shared words", () => {
    expect(chooseOption("Yes", ["Yes", "No"])).toBe(0);
    expect(chooseOption("no", ["YES", "NO"])).toBe(1);
    expect(
      chooseOption("Yes", ["Yes, I consent", "No, I do not consent"]),
    ).toBe(0);
    expect(chooseOption("No", ["Yes, I consent", "No, I do not consent"])).toBe(
      1,
    );
    expect(chooseOption("true", ["Yes", "No"])).toBe(0);
    expect(optionScore("Yes", "No, I do not")).toBe(0);
  });

  it("puts a number into the option range that holds it", () => {
    const years = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10+"];
    expect(chooseOption("7", years)).toBe(7);
    expect(chooseOption("12", years)).toBe(10);
    expect(
      chooseOption("4 years", [
        "Less than 1 year",
        "1-3 years",
        "4-6 years",
        "7+ years",
      ]),
    ).toBe(2);
    expect(chooseOption("0.5", ["Less than 1 year", "1-3 years"])).toBe(0);
    expect(
      chooseOption("35", ["Under 30", "30-39", "40-49", "60 or older"]),
    ).toBe(1);
  });

  it("picks the closest text and refuses a poor match", () => {
    expect(
      chooseOption("Job board", ["LinkedIn", "A friend", "Job board"]),
    ).toBe(2);
    expect(
      chooseOption("2 weeks", ["Available immediately", "2 weeks", "1 month"]),
    ).toBe(1);
    expect(chooseOption("Georgia", ["Germany +49", "Georgia +995"])).toBe(1);
    expect(
      chooseOption("Bachelor's degree", [
        "Bachelor's Degree",
        "Master's Degree",
      ]),
    ).toBe(0);
    expect(chooseOption("Something else entirely", ["Yes", "No"])).toBeNull();
  });

  it("splits a multi-select answer", () => {
    const languages = [
      "English (ENG)",
      "German (DEU)",
      "Russian (RUS)",
      "Choose not to disclose",
    ];
    expect(chooseOptions("English, Russian", languages)).toEqual([0, 2]);
    expect(chooseOptions("German", languages)).toEqual([1]);
    expect(chooseOptions("Klingon", languages)).toEqual([]);
  });

  it("reads numeric ranges", () => {
    expect(numericRange("3-5 years")).toEqual([3, 5]);
    expect(numericRange("10+")).toEqual([10, Number.POSITIVE_INFINITY]);
    expect(numericRange("60 or older")).toEqual([60, Number.POSITIVE_INFINITY]);
    expect(numericRange("Yes")).toBeNull();
  });
});

describe("location parts", () => {
  it("splits city and country", () => {
    expect(cityOf("Tbilisi, Georgia")).toBe("Tbilisi");
    expect(countryOf("Tbilisi, Georgia")).toBe("Georgia");
    expect(countryOf("Tbilisi")).toBe("");
  });
});
