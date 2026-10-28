import type { BrowserApplyRequest } from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import { standardKeyOf, standardValue } from "./standard.js";

const key = (label: string, hints = "", kind = "text") =>
  standardKeyOf({ label, hints, kind });

describe("standard fields", () => {
  it("maps profile labels", () => {
    expect(key("First Name*")).toBe("firstName");
    expect(key("Last name")).toBe("lastName");
    expect(key("Full name✱")).toBe("fullName");
    expect(key("Name", "name:_systemfield_name")).toBe("fullName");
    expect(key("Email", "", "email")).toBe("email");
    expect(key("Phone", "", "tel")).toBe("phone");
    expect(key("Current location")).toBe("location");
    expect(key("Location (City)", "", "combobox")).toBe("location");
    expect(key("Country", "", "combobox")).toBe("country");
    expect(key("LinkedIn Profile")).toBe("linkedin");
    expect(key("Linkedin", "", "textarea")).toBe("linkedin");
    expect(key("GitHub URL")).toBe("github");
    expect(key("Portfolio URL")).toBe("website");
    expect(key("Website")).toBe("website");
    expect(key("Current company")).toBe("currentCompany");
    expect(key("Current title")).toBe("currentTitle");
  });

  it("uses attributes: ATS system fields and autocomplete win over any label", () => {
    expect(
      key(
        "Which country do you intend to work from?",
        "for:_systemfield_location path:_systemfield_location",
        "combobox",
      ),
    ).toBe("location");
    expect(key("Given", "ac:given-name")).toBe("firstName");
    expect(key("", "name:urls[LinkedIn]")).toBe("linkedin");
    expect(key("Org", "name:org")).toBe("currentCompany");
  });

  it("leaves custom questions to the answer bank", () => {
    expect(
      key(
        "Share 2–3 of your open-source contributions with links (GitHub PRs, issues, or projects you maintain)",
        "",
        "textarea",
      ),
    ).toBeNull();
    expect(key("Referrer email", "", "email")).toBe(null);
    expect(
      key("Preferred Name | What would you like us to call you?"),
    ).toBeNull();
    expect(key("Company name of your referrer")).toBeNull();
    expect(
      key("Are you currently located in Portugal?", "", "combobox"),
    ).toBeNull();
    expect(key("Location", "", "radio")).toBeNull();
  });
});

describe("standard values", () => {
  const fields: BrowserApplyRequest["fields"] = {
    firstName: "Alex",
    lastName: "Example",
    fullName: "Alex Example",
    email: "alex@example.com",
    phone: "+44 7700 900123",
    location: "Tbilisi, Georgia",
    linkedin: null,
    github: "  ",
    website: "https://alex.example.com",
    currentCompany: null,
    currentTitle: "Engineer",
  };

  it("reads the request fields; empty means none", () => {
    expect(standardValue("fullName", fields)).toBe("Alex Example");
    expect(standardValue("linkedin", fields)).toBeNull();
    expect(standardValue("github", fields)).toBeNull();
    expect(standardValue("country", fields)).toBe("Georgia");
    expect(
      standardValue("country", { ...fields, location: "Tbilisi" }),
    ).toBeNull();
  });
});
