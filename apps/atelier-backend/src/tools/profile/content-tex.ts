/**
 * Reads the master CV content of the "Minimal violet" template (Work
 * Finder's templates/cv/content.tex): the macros \cvheader, \cvlinks with
 * \cvlink, \cvsummary, \cvskill, \cvjob with its cvbullets, \cvedu, \cvlang.
 * Only the data comes out; the layout stays in the template.
 */

export type ParsedContent = {
  header: {
    name: string;
    location: string;
    phoneDisplay: string;
    phoneDigits: string;
    headline: string;
    stack: string;
  };
  links: { url: string; text: string }[];
  summary: { profile: string; aiTools: string };
  skills: { label: string; items: string[] }[];
  jobs: {
    title: string;
    company: string;
    dates: string;
    location: string;
    description: string;
    bullets: string[];
  }[];
  education: { degree: string; school: string; dates: string }[];
  languages: { name: string; level: string }[];
};

/** Drops comments: an unescaped % to the end of the line, and the line break. */
export function stripComments(source: string) {
  return source.replace(/(?<!\\)%[^\n]*(\n[ \t]*)?/g, "");
}

/** Skips spaces and line breaks from `index`. */
const skipSpace = (source: string, index: number) => {
  let at = index;
  while (at < source.length && /\s/.test(source[at] as string)) at++;
  return at;
};

/** The brace group at `index` (after spaces): its content and where it ends. */
export function readGroup(source: string, index: number) {
  const start = skipSpace(source, index);
  if (source[start] !== "{") return null;
  let depth = 0;
  for (let at = start; at < source.length; at++) {
    const char = source[at];
    if (char === "\\") {
      at++;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0)
        return { value: source.slice(start + 1, at), end: at + 1 };
    }
  }
  throw new Error(`unbalanced braces at ${start}`);
}

/** Every use of `\name` with its `count` brace arguments, in order. */
export function macroCalls(source: string, name: string, count: number) {
  const calls: { args: string[]; start: number; end: number }[] = [];
  const pattern = new RegExp(`\\\\${name}(?![A-Za-z])`, "g");
  for (const match of source.matchAll(pattern)) {
    let at = (match.index ?? 0) + match[0].length;
    const args: string[] = [];
    for (let index = 0; index < count; index++) {
      const group = readGroup(source, at);
      if (!group) break;
      args.push(group.value);
      at = group.end;
    }
    if (args.length === count)
      calls.push({ args, start: match.index ?? 0, end: at });
  }
  return calls;
}

/**
 * LaTeX to plain text. `highlight` keeps \hl{…} as **…** (bullets and the
 * summary may carry highlighted spans); elsewhere the marks are dropped.
 */
export function plain(value: string, highlight = false): string {
  let text = value;
  // Innermost groups first, so nested macros resolve.
  for (let pass = 0; pass < 5; pass++) {
    text = text
      .replace(/\\hl\{([^{}]*)\}/g, highlight ? "**$1**" : "$1")
      .replace(/\\(?:textbf|textit|emph|mbox|text|cvhl)\{([^{}]*)\}/g, "$1")
      .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, "$1");
  }
  return text
    .replace(/\\linksep/g, " ")
    .replace(/\\(?:,|;|:|quad|qquad|newline|\\)/g, " ")
    .replace(/\\([%&_#$])/g, "$1")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~/g, " ")
    .replace(/\\[A-Za-z]+\*?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\*\*\s*\*\*/g, "")
    .trim();
}

/** The items of one \begin{cvbullets} … \end{cvbullets} block. */
function bulletsAfter(source: string, from: number, until: number) {
  const body = source.slice(from, until);
  const block = /\\begin\{cvbullets\}([\s\S]*?)\\end\{cvbullets\}/.exec(body);
  if (!block?.[1]) return [];
  return block[1]
    .split(/\\item\b/)
    .slice(1)
    .map((item) => plain(item, true))
    .filter(Boolean);
}

/** Splits a skill row on commas outside parentheses. */
export function splitItems(value: string) {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth = Math.max(0, depth - 1);
    if ((char === "," || char === "·") && depth === 0) {
      items.push(current);
      current = "";
    } else current += char;
  }
  items.push(current);
  return items.map((item) => item.trim()).filter(Boolean);
}

export function parseContentTex(source: string): ParsedContent {
  const tex = stripComments(source);
  const [header] = macroCalls(tex, "cvheader", 6);
  if (!header)
    throw new Error(
      "content.tex: no \\cvheader{name}{city}{phone}{digits}{headline}{stack}",
    );
  const [name, location, phoneDisplay, phoneDigits, headline, stack] =
    header.args.map((arg) => plain(arg)) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
  const links = macroCalls(tex, "cvlink", 2).map(({ args }) => ({
    url: plain(args[0] as string).replace(/\s+/g, ""),
    text: plain(args[1] as string),
  }));
  const [summary] = macroCalls(tex, "cvsummary", 2);
  if (!summary)
    throw new Error("content.tex: no \\cvsummary{profile}{aiTools}");
  const skills = macroCalls(tex, "cvskill", 2).map(({ args }) => ({
    label: plain(args[0] as string),
    items: splitItems(plain(args[1] as string)),
  }));
  const jobCalls = macroCalls(tex, "cvjob", 5);
  const sectionStarts = [...tex.matchAll(/\\cvsection\b/g)].map(
    (match) => match.index ?? 0,
  );
  const jobs = jobCalls.map((call, index) => {
    const nextJob = jobCalls[index + 1];
    const nextSection = sectionStarts.find((at) => at > call.end) ?? tex.length;
    const until = Math.min(nextJob ? nextJob.start : tex.length, nextSection);
    const [title, company, dates, place, description] = call.args.map((arg) =>
      plain(arg),
    ) as [string, string, string, string, string];
    return {
      title,
      company,
      dates,
      location: place,
      description,
      bullets: bulletsAfter(tex, call.end, until),
    };
  });
  return {
    header: {
      name,
      location,
      phoneDisplay,
      phoneDigits: phoneDigits.replace(/[^\d+]/g, ""),
      headline,
      stack,
    },
    links,
    summary: {
      profile: plain(summary.args[0] as string, true),
      aiTools: plain(summary.args[1] as string, true),
    },
    skills,
    jobs,
    education: macroCalls(tex, "cvedu", 3).map(({ args }) => ({
      degree: plain(args[0] as string),
      school: plain(args[1] as string),
      dates: plain(args[2] as string),
    })),
    languages: macroCalls(tex, "cvlang", 2).map(({ args }) => ({
      name: plain(args[0] as string),
      level: plain(args[1] as string),
    })),
  };
}
