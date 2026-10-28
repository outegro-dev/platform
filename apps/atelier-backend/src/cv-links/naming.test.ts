import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  cvFileName,
  isBot,
  isLinkHash,
  linkHash,
  roleWords,
} from "./naming.js";

describe("CV link names", () => {
  it("names the file First_Last_Role_Words_CV.pdf from cvRole", () => {
    expect(
      cvFileName(
        { firstName: "Alex", lastName: "Example" },
        { senior: true, focus: "Backend", noun: "Engineer" },
      ),
    ).toBe("Alex_Example_Senior_Backend_Engineer_CV.pdf");
    expect(
      cvFileName(
        { firstName: "Alex", lastName: "Example" },
        { senior: false, focus: "Full-Stack", noun: "Developer" },
      ),
    ).toBe("Alex_Example_Full-Stack_Developer_CV.pdf");
  });

  it("drops accents and odd characters, and falls back to Software Engineer", () => {
    expect(
      cvFileName({ firstName: "José", lastName: "Ñúñez O'Brien" }, null),
    ).toBe("Jose_Nunez_O_Brien_Software_Engineer_CV.pdf");
    expect(roleWords(null)).toBe("Software Engineer");
  });

  it("makes 12-character base62 hashes that do not repeat", () => {
    const hashes = new Set(Array.from({ length: 2000 }, () => linkHash()));
    expect(hashes.size).toBe(2000);
    for (const hash of hashes) expect(isLinkHash(hash)).toBe(true);
    expect(isLinkHash("robots.txt")).toBe(false);
  });

  it("tells link previews and crawlers from people", () => {
    const bots = [
      "TelegramBot (like TwitterBot)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
      "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "WhatsApp/2.23.20.0",
      "Twitterbot/1.0",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
      "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)",
      "SomeCrawler/1.0",
      "Iframely link preview",
      "",
      undefined,
    ];
    for (const agent of bots) expect(isBot(agent), String(agent)).toBe(true);
    const people = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0",
    ];
    for (const agent of people) expect(isBot(agent), agent).toBe(false);
  });

  it("serves the clean name inline or as an attachment", () => {
    expect(contentDisposition("inline", "Alex_Example_CV.pdf")).toBe(
      `inline; filename="Alex_Example_CV.pdf"; filename*=UTF-8''Alex_Example_CV.pdf`,
    );
    expect(contentDisposition("attachment", 'a"b.pdf')).toContain(
      'filename="a_b.pdf"',
    );
  });
});
