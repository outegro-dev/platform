import Image from "next/image";
import { getTranslations } from "next-intl/server";
import me from "@/assets/zine/me.webp";
import { WhenNear } from "@/components/when-near";

type Row = { q: string; a: string };
type Craft = { craft: string; a: string };
type Toys = { q: string; items: Craft[] };

/** Where the toys can be seen at work, in their order: the frontend, the
 * backend. */
const toyLinks = ["/stack#frontend", "/stack#backend"];

/**
 * The inside of the cover: the work told as a page of a school friends'
 * questionnaire. A title in felt-tip letters, a photo held by album
 * corners, a doodle by it, and questions in print answered in ballpoint:
 * who, what for, the favourite toys (the frontend and the backend, each on
 * its line with what it is made of, marked with a highlighter and linking
 * to where it can be seen at work) and, for a laugh, the favourite hobby.
 */
export async function FriendForm() {
  const t = await getTranslations("zine.form");
  const name = t.raw("name") as Row;
  const job = t.raw("job") as Row;
  const toys = t.raw("toys") as Toys;
  const hobby = t.raw("hobby") as Row;
  const title = t("title");
  // the pens go round the letters of the whole title, word after word
  let pen = 0;
  return (
    <div className="form">
      {/* first, so the title and the doodle flow beside it; the answers
          take the page's width under it */}
      <figure className="form-photo">
        {/* half a screen ahead: on a phone the first layout has it under two
            screens down. The print is a third of a phone's page and a sixth
            of a tablet's spread; a wider screen sizes the spread by its
            height */}
        <WhenNear
          className="form-photo-print"
          ahead="50% 0px"
          label={t("photo")}
        >
          <Image
            src={me}
            alt={t("photo")}
            sizes="(max-width: 767px) 32vw, (max-width: 1023px) 17vw, (max-aspect-ratio: 4/5) 17vw, calc(24vh - 40px)"
          />
        </WhenNear>
        <figcaption>{t("me")}</figcaption>
      </figure>
      <h2
        className="form-title"
        id="form-title"
        style={{ "--letters": title.length } as React.CSSProperties}
      >
        <span className="sr-only">{title}</span>
        <span aria-hidden="true">
          {title.split(" ").map((word, w) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: words can repeat; the position is the identity.
            <span key={`${word}-${w}`} className="form-word">
              {[...word].map((letter, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: letters repeat; the position is the identity.
                  key={i}
                  className={`form-pen-${pen++ % 4}`}
                >
                  {letter}
                </span>
              ))}
            </span>
          ))}
        </span>
        <small>{t("subtitle")}</small>
      </h2>
      {/* drawn by the photo in the same ballpoint: a boat under sail, the
          sun and two gulls, the flag gone over in red felt-tip */}
      <svg className="form-doodle" viewBox="0 0 220 128" aria-hidden="true">
        <path d="M33 17a10 10 0 1 0 1 0zM34 2v6M34 41v6M15 27H9M59 27h-6M21 14l-4-4M47 14l4-4M21 40l-4 4M47 40l4 4M158 30q5-6 10 0q5-6 10 0M178 46q4-5 8 0q4-5 8 0M112 90V12M116 20q28 26 36 60h-36zM108 26q-20 24-30 54h30zM56 90h116q-6 18-22 20H80q-18-2-24-20zM58 93h112M82 96l-6 10M96 96l-6 12M110 96l-6 12M124 96l-6 12M138 96l-6 12M152 96l-6 12M4 114q12-8 24 0t24 0 24 0 24 0 24 0 24 0 24 0 24 0 24 0M44 124q10-6 20 0t20 0 20 0 20 0 20 0 20 0" />
        <path className="form-doodle-flag" d="M112 12l16 5-16 5z" />
      </svg>
      <dl className="form-rows" aria-labelledby="form-title">
        <div>
          <dt>{name.q}</dt>
          <dd>{name.a}</dd>
        </div>
        <div>
          <dt>{job.q}</dt>
          <dd>{job.a}</dd>
        </div>
        <div className="is-list">
          <dt>{toys.q}</dt>
          <dd>
            <ul className="form-list">
              {toys.items.map((toy, i) => (
                <li key={toy.craft}>
                  <a href={toyLinks[i]}>
                    <mark>{toy.craft}</mark> — {toy.a}
                  </a>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>{hobby.q}</dt>
          <dd>{hobby.a}</dd>
        </div>
      </dl>
    </div>
  );
}
