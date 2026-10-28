import { redirectedToList } from "./browser-only.js";
import { scrape } from "./fetch-vacancy.js";
import { htmlToText } from "./html.js";
import { defaultHttp, type Http, type HttpResponse } from "./http.js";

/** Phrases of a closed posting (Work Finder's check-vacancies). */
export const closedPhrases = [
  /no longer (?:accepting|available|open|active)/i,
  /(?:job|position|posting|vacancy|role) (?:has been|is) (?:closed|filled|expired|removed)/i,
  /this (?:job|position|posting) (?:has )?expired/i,
  /job (?:not found|does not exist)/i,
  /posting (?:is )?(?:closed|unavailable)/i,
  /we are not accepting applications/i,
  /applications? (?:are|is) (?:now )?closed/i,
  /ваканси[яи] (?:закрыта|в архиве|неактуальна|больше не актуальна|снята)/i,
  /при[её]м (?:откликов|заявок) (?:закрыт|завершен|завершён)/i,
];

async function probe(link: string, http: Http): Promise<HttpResponse | null> {
  try {
    return await http.get(link, { accept: "html" });
  } catch {
    return null;
  }
}

/**
 * Whether a vacancy is still open (port of Work Finder's check): closed on
 * HTTP 404/410, when the board API no longer has it and the page is not
 * 200, when Ashby or Workable no longer list it, when the page says so, or
 * when it redirects to a list of jobs; unknown when the page is blocked,
 * renders only in a browser or has under 300 characters of text.
 */
export async function checkLiveness(
  url: string,
  http: Http = defaultHttp(),
): Promise<"open" | "closed" | "unknown"> {
  const page = await probe(url, http);
  const { result, trace } = await scrape(url, http, page);
  const status = page?.status ?? null;
  if (status === 404 || status === 410) return "closed";
  if (
    (trace.apiStatus === 404 || trace.apiStatus === 410) &&
    status !== 200 &&
    !result.ok
  )
    return "closed";
  if (trace.notOnBoard && !result.ok) return "closed";
  if (!result.ok && result.status === "closed") return "closed";
  const text = result.ok
    ? result.fields.text
    : page
      ? htmlToText(page.text).slice(0, 60_000)
      : "";
  const scope = result.ok ? text.slice(0, 5_000) : text;
  if (closedPhrases.some((pattern) => pattern.test(scope))) return "closed";
  if (redirectedToList(url, page?.url)) return "closed";
  if (!result.ok) return "unknown";
  if (result.fields.text.length < 300) return "unknown";
  return "open";
}
