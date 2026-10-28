import { describe, expect, it } from "vitest";
import { readVacancyInput, TEXT_MIN, vacancyRequest } from "./vacancy";

const long = "We are hiring a senior engineer. ".repeat(6);

describe("the add-vacancy field", () => {
  it("is empty with only whitespace", () => {
    expect(readVacancyInput("   \n ").kind).toBe("empty");
  });

  it("takes a link, with or without https://", () => {
    expect(readVacancyInput("https://jobs.lever.co/acme/123")).toMatchObject({
      kind: "url",
      host: "jobs.lever.co",
    });
    expect(readVacancyInput("www.northwind.example/careers/42")).toMatchObject({
      kind: "url",
      url: "https://www.northwind.example/careers/42",
      host: "northwind.example",
    });
  });

  it("refuses a broken link instead of reading it as text", () => {
    expect(readVacancyInput("https://jobs lever co").kind).toBe("bad-url");
    expect(readVacancyInput("https://localhost").kind).toBe("bad-url");
    expect(readVacancyInput("ftp://files.example/job").kind).not.toBe("url");
  });

  it("counts pasted text and asks for at least 100 characters", () => {
    expect(readVacancyInput("Senior engineer, remote")).toEqual({
      kind: "short",
      length: 23,
    });
    expect(readVacancyInput(long).kind).toBe("text");
    expect(long.trim().length).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it("refuses more than 200,000 characters", () => {
    expect(readVacancyInput("a b ".repeat(60_000)).kind).toBe("long");
  });

  it("builds the request of the contract only for a valid input", () => {
    expect(vacancyRequest(readVacancyInput(long))).toEqual({
      text: long.trim(),
    });
    expect(
      vacancyRequest(readVacancyInput("https://jobs.ashbyhq.com/acme/1")),
    ).toEqual({ url: "https://jobs.ashbyhq.com/acme/1" });
    expect(vacancyRequest(readVacancyInput("short"))).toBeNull();
    expect(vacancyRequest({ kind: "empty" })).toBeNull();
  });
});
