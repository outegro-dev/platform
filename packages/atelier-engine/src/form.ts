import type {
  Profile,
  Salary,
  VacancyFields,
} from "@outegro/contracts/atelier";

/*
 * The answer bank for common ATS questions, from the profile's form answers.
 * Code answers what it knows for sure; anything else is null with
 * confidence 0, for the texts step or a human. With options, the answer is
 * always exactly one of them.
 */

export type FormAnswer = {
  answer: string | null;
  confidence: number;
  key: string;
};

type Period = Salary["period"];

const unknown: FormAnswer = { answer: null, confidence: 0, key: "unknown" };

const lower = (value: string) => value.toLowerCase().replace(/[’‘]/g, "'");

/** The option that means yes (or no). */
function yesNo(options: string[], yes: boolean) {
  const pattern = yes ? /^\s*(yes|y|true|да)\b/i : /^\s*(no|n|false|нет)\b/i;
  return options.find((option) => pattern.test(option)) ?? null;
}

/** The option that declines to answer (EEO and similar). */
function declineOption(options: string[]) {
  return (
    options.find((option) =>
      /decline|prefer not|rather not|do(?:n't| not) wish|not (?:to )?(?:say|answer|disclose|specify|identify)|choose not|wish not|no answer|не указывать/i.test(
        option,
      ),
    ) ?? null
  );
}

/** First option whose text contains one of the words. */
const optionWith = (options: string[], words: RegExp) =>
  options.find((option) => words.test(option)) ?? null;

const answered = (
  answer: string | null,
  confidence: number,
  key: string,
): FormAnswer =>
  answer === null
    ? { answer: null, confidence: 0, key }
    : { answer, confidence, key };

/* ---------- Salary ---------- */

const perPeriod: Record<Period, number> = { year: 1, month: 12, hour: 1920 };

function convert(amount: number, from: Period, to: Period) {
  return (amount * perPeriod[from]) / perPeriod[to];
}

const roundFor = (amount: number, period: Period) =>
  period === "hour"
    ? Math.round(amount)
    : period === "month"
      ? Math.round(amount / 100) * 100
      : Math.round(amount / 1000) * 1000;

/** The period a salary question asks about, null when it does not say. */
function askedPeriod(question: string): Period | null {
  if (
    /annual|per (?:year|annum)|yearly|\/\s*y(?:ea)?r|a year|годов|в год/i.test(
      question,
    )
  )
    return "year";
  if (/month|monthly|\/\s*mo|в месяц|ежемесяч/i.test(question)) return "month";
  if (/hour|hourly|\/\s*h(?:ou)?r|в час/i.test(question)) return "hour";
  return null;
}

/** The amount to state: the vacancy's midpoint, its only bound, or the profile's floor. */
function salaryBasis(profile: Profile, fields: VacancyFields) {
  const salary = fields.salary;
  if (salary && salary.min !== null && salary.max !== null)
    return {
      amount: (salary.min + salary.max) / 2,
      currency: salary.currency,
      period: salary.period,
      from: false,
    };
  if (salary && (salary.min ?? salary.max) !== null)
    return {
      amount: (salary.min ?? salary.max) as number,
      currency: salary.currency,
      period: salary.period,
      from: true,
    };
  const own = profile.form.salaryFrom;
  return {
    amount: own.amount,
    currency: own.currency,
    period: own.period as Period,
    from: true,
  };
}

/** Numbers of an option such as "$50k - $70k", "4 000–5 000", "100,000+". */
function optionRange(option: string) {
  const values = [
    ...option
      .replace(/(\d)[ ,](?=\d{3}\b)/g, "$1")
      .matchAll(/(\d+(?:\.\d+)?)\s*(k)?/gi),
  ].map((match) => Number(match[1]) * (match[2] ? 1000 : 1));
  if (!values.length) return null;
  const plus = /\+|above|more|over|or more|выше|более/i.test(option);
  const under = /under|below|less|up to|до\b/i.test(option);
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (plus) return { low, high: Number.POSITIVE_INFINITY };
  if (under) return { low: 0, high };
  return { low, high: values.length > 1 ? high : low };
}

function salaryAnswer(
  question: string,
  options: string[] | null,
  profile: Profile,
  fields: VacancyFields,
): FormAnswer {
  const basis = salaryBasis(profile, fields);
  const period = askedPeriod(question) ?? basis.period;
  const amount = roundFor(convert(basis.amount, basis.period, period), period);
  const asksCurrency = question
    .match(/\b(USD|EUR|GBP|CHF|PLN|GEL|CAD|AUD)\b/i)?.[1]
    ?.toUpperCase();
  const confidence =
    asksCurrency && asksCurrency !== basis.currency.toUpperCase() ? 0.5 : 0.85;
  if (options?.length) {
    const ranged = options
      .map((option) => ({ option, range: optionRange(option) }))
      .filter(
        (
          item,
        ): item is { option: string; range: { low: number; high: number } } =>
          item.range !== null,
      );
    const inside = ranged.find(
      (item) => amount >= item.range.low && amount <= item.range.high,
    );
    const closest = [...ranged].sort(
      (a, b) =>
        Math.min(
          Math.abs(a.range.low - amount),
          Math.abs(a.range.high - amount),
        ) -
        Math.min(
          Math.abs(b.range.low - amount),
          Math.abs(b.range.high - amount),
        ),
    )[0];
    const pick = inside ?? closest;
    return pick
      ? {
          answer: pick.option,
          confidence: inside ? confidence : 0.4,
          key: "salary",
        }
      : { ...unknown, key: "salary" };
  }
  if (
    /\b(numbers?|numeric|digits?|amount|integer|figure)\b|e\.g\.,? \d{3,}|числ/i.test(
      question,
    )
  )
    return { answer: String(amount), confidence, key: "salary" };
  const formatted = amount.toLocaleString("en-US");
  const per =
    period === "year"
      ? "per year"
      : period === "month"
        ? "per month"
        : "per hour";
  return {
    answer: `${basis.from ? "From " : ""}${formatted} ${basis.currency} gross ${per}, flexible depending on the package`,
    confidence,
    key: "salary",
  };
}

/* ---------- Other questions ---------- */

const city = (location: string) => location.split(",")[0]?.trim() ?? location;
const country = (location: string) =>
  location.split(",").at(-1)?.trim() ?? location;

/**
 * The company the profile works at now: of those whose dates say Present,
 * the first full-time one in CV order (a part-time role is a side job).
 */
function currentJob(profile: Profile) {
  const now = [...profile.companies]
    .sort((a, b) => a.order - b.order)
    .filter((company) =>
      /present|now|current|по настоящее|н\.?\s*в\./i.test(company.dates),
    );
  return (
    now.find((company) => !/part[- ]?time/i.test(company.title)) ??
    now[0] ??
    null
  );
}

function noticeAnswer(
  question: string,
  options: string[] | null,
  weeks: number,
  key: string,
): FormAnswer {
  if (options?.length) {
    const words = weeks === 0 ? /immediate|asap|right away|now|сразу/i : null;
    const byWords = words ? optionWith(options, words) : null;
    const byNumber = options.find((option) => {
      const value = Number(option.match(/\d+/)?.[0] ?? Number.NaN);
      if (Number.isNaN(value)) return false;
      if (/week|недел/i.test(option)) return value === weeks;
      if (/month|месяц/i.test(option))
        return value * 4 === weeks || (value === 1 && weeks >= 4 && weeks <= 5);
      if (/day|дн/i.test(option)) return value === weeks * 7;
      return false;
    });
    const within = options.find((option) => {
      const value = Number(option.match(/\d+/)?.[0] ?? Number.NaN);
      return (
        /within|up to|less than|до\b/i.test(option) &&
        /week/i.test(option) &&
        value >= weeks
      );
    });
    const pick = byWords ?? byNumber ?? within;
    return pick
      ? { answer: pick, confidence: 0.8, key }
      : { answer: null, confidence: 0, key };
  }
  if (/\bnumber\b|\(weeks?\)|in weeks/i.test(question))
    return { answer: String(weeks), confidence: 0.85, key };
  if (weeks === 0) return { answer: "Immediately", confidence: 0.9, key };
  const span = `${weeks} week${weeks === 1 ? "" : "s"}`;
  return {
    answer:
      key === "start_date"
        ? `In ${span}, after my notice period`
        : `${span} notice period`,
    confidence: 0.9,
    key,
  };
}

/** Answer of one ATS form question from the profile (and the vacancy for salary and remote). */
export function answerForm(
  question: string,
  options: string[] | null,
  profile: Profile,
  fields: VacancyFields,
): FormAnswer {
  const q = lower(question);
  const form = profile.form;
  const person = profile.person;
  const list = options?.filter((option) => option.trim()) ?? null;
  const choose = (
    value: boolean,
    key: string,
    confidence = 0.9,
    text?: string,
  ): FormAnswer =>
    list?.length
      ? answered(yesNo(list, value), confidence, key)
      : { answer: text ?? (value ? "Yes" : "No"), confidence, key };

  // EEO and other demographic questions: always the option that declines.
  if (
    /gender|sex\b|race|ethnic|hispanic|latino|veteran|disabilit|sexual orientation|transgender|lgbt/i.test(
      q,
    )
  ) {
    const key = /veteran/.test(q)
      ? "eeo_veteran"
      : /disabilit/.test(q)
        ? "eeo_disability"
        : /race|ethnic|hispanic|latino/.test(q)
          ? "eeo_race"
          : "eeo_gender";
    if (list?.length) return answered(declineOption(list), 0.95, key);
    return { answer: "I prefer not to say", confidence: 0.8, key };
  }
  if (/pronoun/.test(q))
    return { answer: null, confidence: 1, key: "pronouns" };

  if (
    /salary|compensation|pay expectation|rate expectation|expected (?:pay|rate)|desired (?:pay|rate)|зарплат|оклад|вознагражд/.test(
      q,
    ) &&
    !/currency/.test(q)
  )
    return salaryAnswer(question, list, profile, fields);

  if (/notice/.test(q))
    return noticeAnswer(question, list, form.noticeWeeks, "notice");
  // A start date split into parts ("Start date year", "Start date month").
  if (
    /start date|available (?:from|to start)/.test(q) &&
    /\b(year|month|day)\b/.test(q)
  ) {
    const start = new Date(Date.now() + form.noticeWeeks * 7 * 86_400_000);
    const part = /\byear\b/.test(q)
      ? String(start.getUTCFullYear())
      : /\bmonth\b/.test(q)
        ? start.toLocaleString("en-US", { month: "long", timeZone: "UTC" })
        : String(start.getUTCDate());
    // Below the bar on purpose: "Start date month" is as often an education
    // or job-history field as the availability date, so it stays a suggestion.
    if (list?.length)
      return answered(
        list.find((option) => lower(option).includes(lower(part))) ?? null,
        0.45,
        "start_date",
      );
    return { answer: part, confidence: 0.45, key: "start_date" };
  }
  if (
    /start date|when can you start|earliest (?:start|date)|available to start|availability to start|join us|когда (?:можете|готовы) (?:приступить|выйти)/.test(
      q,
    )
  )
    return noticeAnswer(question, list, form.noticeWeeks, "start_date");

  if (/sponsor|visa/.test(q))
    return choose(
      form.needsSponsorship,
      "sponsorship",
      0.9,
      form.needsSponsorship ? "Yes" : "No, I don't need visa sponsorship",
    );
  // Worked at this company before: no (the profile lists every employer).
  if (
    /(?:previously|ever|before) (?:worked|been employed|consulted)|worked (?:at|for) .* before|former employee/.test(
      q,
    )
  ) {
    const own = profile.companies.some((company) =>
      q.includes(lower(company.name)),
    );
    return choose(own, "worked_here_before", 0.9);
  }
  // Spoken English: the profile's level.
  if (/english/.test(q) && /proficien|level|fluen|speak|communicat/.test(q)) {
    const english = profile.languages.find((item) =>
      /english|англ/i.test(item.name),
    );
    if (!english) return unknown;
    if (list?.length) {
      const native = /c2|native/i.test(english.level);
      // C1 is not "native": an option that claims it is only a last resort.
      const fluent = list.filter((option) =>
        /\bc1\b|advanced|fluent|full professional/i.test(option),
      );
      const advanced =
        (native ? optionWith(list, /\bc2\b|native|bilingual/i) : null) ??
        fluent.find((option) => !/native|\bc2\b|bilingual/i.test(option)) ??
        optionWith(list, /professional|proficient|business/i) ??
        fluent[0];
      if (advanced) return answered(advanced, 0.85, "english");
      return answered(yesNo(list, true), 0.85, "english");
    }
    return {
      answer: /^do you|^are you|^have you/.test(q)
        ? `Yes, ${english.level}`
        : english.level,
      confidence: 0.9,
      key: "english",
    };
  }
  // The currency of a salary answer: the vacancy's, else the profile's.
  if (/currency/.test(q)) {
    const currency =
      fields.salary?.currency ??
      (/europe|emea|\beu\b|germany|spain|portugal|france|netherlands|poland|ireland|italy/i.test(
        fields.location ?? "",
      )
        ? "EUR"
        : form.salaryFrom.currency);
    if (list?.length)
      return answered(
        optionWith(list, new RegExp(`\\b${currency}\\b`, "i")),
        0.85,
        "currency",
      );
    return { answer: currency, confidence: 0.85, key: "currency" };
  }
  // Consent and acknowledgement questions (privacy policy, GDPR).
  if (
    /gdpr|privacy (?:policy|notice)|data (?:processing|protection)|acknowledg|consent|i (?:have read|agree|confirm)/.test(
      q,
    ) &&
    !/marketing|newsletter|future (?:jobs|roles|opportunities)|talent (?:pool|community)/.test(
      q,
    )
  ) {
    if (list?.length)
      return answered(
        optionWith(
          list,
          /\b(yes|i agree|agree|accept|acknowledge|confirm|i do)\b/i,
        ),
        0.85,
        "consent",
      );
    return { answer: "Yes", confidence: 0.85, key: "consent" };
  }
  // Interview or work accommodations: none needed.
  if (/accommodation|adjustment|additional support|accessib/.test(q))
    return choose(false, "accommodations", 0.85, "No, thank you");
  // Contract type: B2B / contractor arrangements suit the profile.
  if (/\bb2b\b|contractor|freelance|employment type|contract type/.test(q)) {
    const b2b = /b2b|contractor|entrepreneur/i.test(form.contract);
    if (list?.length) {
      const pick =
        (b2b ? optionWith(list, /\bb2b\b|contract/i) : null) ??
        yesNo(list, b2b);
      return answered(pick, 0.8, "contract");
    }
    return {
      answer: b2b ? "Yes, B2B works for me" : form.contract,
      confidence: 0.8,
      key: "contract",
    };
  }
  // Working in (or overlapping) European hours.
  if (
    /(?:eu|europe(?:an)?|cet|emea)\b.*time ?zone|time ?zone.*(?:eu|europe|cet|emea)\b/.test(
      q,
    )
  ) {
    const offset = Number(
      /gmt|utc/i.test(form.timezone)
        ? /([+-]\d+)/.exec(form.timezone)?.[1]
        : Number.NaN,
    );
    const near = Number.isFinite(offset) && offset >= -1 && offset <= 4;
    return choose(
      near,
      "eu_timezone",
      0.8,
      near ? `Yes, ${form.timezone}, overlapping European working hours` : "No",
    );
  }
  // Contract restrictions with the current employer: none.
  if (
    /employment agreement|non-?compete|non-?solicit|post-employment|restrictive covenant|garden leave|subject to any (?:agreement|restriction)/.test(
      q,
    )
  )
    return choose(false, "employment_restrictions", 0.9, "No");
  if (
    /authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work|legally (?:able|allowed|permitted) to work|work permit/.test(
      q,
    )
  ) {
    const home = country(form.location);
    // A question about a named jurisdiction other than home ("eligible to
    // work in the United States or Canada?") is a plain no.
    const jurisdictions =
      /united states|\bu\.?s\.?a?\b|\bus\b|america|canada|united kingdom|\buk\b|britain|england|european union|\beu\b|\beea\b|schengen|germany|france|spain|portugal|poland|netherlands|ireland|italy|switzerland|australia|india|israel|brazil|mexico/;
    const asked = q.match(jurisdictions)?.[0];
    if (asked && !lower(home).includes(asked.replace(/\./g, "")))
      return choose(false, "work_authorization", 0.9, "No");
    const named = /\bin (?:the )?([a-z][a-z .]+?)[?.]?$/i
      .exec(question)?.[1]
      ?.trim();
    const elsewhere =
      named &&
      !lower(home).includes(lower(named)) &&
      !/remote|country|location/i.test(named);
    if (fields.remote === false && elsewhere)
      return { answer: null, confidence: 0, key: "work_authorization" };
    return choose(
      true,
      "work_authorization",
      elsewhere ? 0.6 : 0.85,
      `Yes. I work remotely from ${home} as a ${form.contract.replace(/^B2B contractor/i, "B2B contractor")}, so no visa sponsorship is needed.`,
    );
  }
  if (/relocat|переезд/.test(q))
    return choose(
      form.relocation,
      "relocation",
      0.9,
      form.relocation
        ? "Yes, I'm open to relocation"
        : "No, I'm looking for a remote role",
    );
  if (
    /remote|hybrid|on-?site|in office|office|work (?:format|arrangement|setup|model)|формат работы|удал[её]н/.test(
      q,
    )
  ) {
    if (list?.length) {
      const wanted = lower(form.workFormat);
      const word = /remote|удал/.test(wanted)
        ? /remote|удал/i
        : /hybrid|гибрид/.test(wanted)
          ? /hybrid|гибрид/i
          : /on-?site|office|офис/i;
      const byFormat = optionWith(list, word);
      if (byFormat)
        return { answer: byFormat, confidence: 0.85, key: "work_format" };
      // A yes/no question ("Are you comfortable working remotely?").
      if (/remote/.test(q))
        return answered(
          yesNo(list, /remote|удал/.test(wanted)),
          0.8,
          "work_format",
        );
      return { answer: null, confidence: 0, key: "work_format" };
    }
    return { answer: form.workFormat, confidence: 0.85, key: "work_format" };
  }
  if (/time ?zone|часов(?:ой|ом) пояс/.test(q)) {
    if (list?.length) {
      const zone = lower(form.timezone).replace(/\s+/g, "");
      return answered(
        list.find((option) =>
          lower(option).replace(/\s+/g, "").includes(zone),
        ) ?? null,
        0.8,
        "timezone",
      );
    }
    return { answer: form.timezone, confidence: 0.9, key: "timezone" };
  }
  if (
    /years of (?:professional |commercial |relevant |work )?experience|how many years|experience \(years\)|опыт.*лет|сколько лет/.test(
      q,
    )
  ) {
    const years = profile.baseYears;
    if (list?.length) {
      const pick = list.find((option) => {
        const range = optionRange(option);
        return range !== null && years >= range.low && years <= range.high;
      });
      return answered(pick ?? null, 0.85, "years");
    }
    return { answer: String(years), confidence: 0.9, key: "years" };
  }
  if (/linkedin/.test(q)) return answered(person.linkedin, 1, "linkedin");
  if (/github/.test(q)) return answered(person.github, 1, "github");
  if (/website|portfolio|personal site|blog|homepage|сайт|портфолио/.test(q))
    return answered(person.website, 0.9, "website");
  if (
    /how did you (?:hear|find|learn)|where did you (?:hear|find|see)|source of (?:application|referral)|referral source|откуда вы узнали|как вы узнали/.test(
      q,
    )
  ) {
    const board = !fields.ats && !/career|company/i.test(fields.provider);
    if (list?.length) {
      const provider = new RegExp(
        fields.provider.replace(/[^a-z0-9]/gi, "").slice(0, 20) || "^$",
        "i",
      );
      const pick =
        optionWith(list, provider) ??
        (board
          ? optionWith(list, /job board|job site|job posting|online|internet/i)
          : optionWith(list, /career|company (?:web)?site|website/i)) ??
        optionWith(list, /job board|career|website|online|other/i);
      return answered(pick, 0.7, "source");
    }
    return {
      answer: board ? "Job board" : "Company careers page",
      confidence: 0.7,
      key: "source",
    };
  }
  // Social handles the profile has no value for: leave the field empty.
  if (
    /^(?:x|twitter|x \(twitter\)|twitter (?:handle|profile|url)|x (?:handle|profile|url))$/.test(
      q,
    )
  )
    return { answer: null, confidence: 1, key: "social" };
  // Identity fields below never answer a yes/no question ("Are you subject
  // to any agreement with your current employer?").
  if (
    /^(?:are|do|does|did|have|has|will|would|can|could|is|were|should) /.test(q)
  )
    return unknown;
  if (
    /current (?:company|employer)|present (?:company|employer)|current workplace|текущ(?:ая|ее) (?:компания|место)/.test(
      q,
    )
  )
    return answered(currentJob(profile)?.name ?? null, 0.9, "current_company");
  if (
    /current (?:job )?title|current (?:role|position)|job title|текущая должность/.test(
      q,
    )
  )
    return answered(currentJob(profile)?.title ?? null, 0.9, "current_title");
  if (
    /^(?:current )?(?:city|town)\b|which city|city of residence|город/.test(q)
  )
    return { answer: city(form.location), confidence: 0.9, key: "city" };
  if (
    /country of residence|^country\b|(?:which|what) country|country (?:are|do) you|current country|страна/.test(
      q,
    )
  )
    return { answer: country(form.location), confidence: 0.9, key: "country" };
  if (
    /location|where are you (?:based|located)|current address|based in|местоположен|где вы находитесь/.test(
      q,
    )
  )
    return { answer: form.location, confidence: 0.9, key: "location" };
  if (/^first name|given name|^имя\b/.test(q))
    return { answer: person.firstName, confidence: 1, key: "first_name" };
  if (/^last name|family name|surname|фамилия/.test(q))
    return { answer: person.lastName, confidence: 1, key: "last_name" };
  if (
    /^(?:full |legal |full legal )?name$|^(?:full |legal )?name[:*(]|^your (?:full )?name$|фио/.test(
      q,
    )
  )
    return { answer: person.name, confidence: 1, key: "full_name" };
  if (/^(?:your )?e-?mail(?: address)?\b/.test(q))
    return { answer: person.email, confidence: 1, key: "email" };
  if (/^(?:your )?(?:phone|mobile|telephone)(?: number)?\b|телефон/.test(q))
    return { answer: person.phoneDisplay, confidence: 1, key: "phone" };
  return unknown;
}
