import Image from "next/image";
import { getTranslations } from "next-intl/server";
import me from "@/assets/zine/me.webp";

type Row = { q: string; a: string };
type Craft = { craft: string; a: string };
type Toys = { q: string; items: Craft[] };

/** Where the toys can be seen at work, in their order: the frontend, the
 * backend. */
const toyLinks = ["/stack#frontend", "/stack#backend"];

/**
 * The inside of the cover: the work told as a page of a school friends'
 * questionnaire. A title in felt-tip letters, a photo held by album
 * corners, and questions in print answered in ballpoint: who, what for,
 * the favourite toys (the frontend and the backend, each on its line with
 * what it is made of, marked with a highlighter and linking to where it
 * can be seen at work) and, for a laugh, the favourite hobby.
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
      {/* first, so the title and the answers flow around it */}
      <figure className="form-photo">
        <Image
          src={me}
          alt={t("photo")}
          sizes="(min-width: 1024px) 18vw, 40vw"
        />
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
