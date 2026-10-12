import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { fontVariables } from "@outegro/ui/fonts";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { Notice } from "@outegro/ui/notice";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { type ContrastPair, ContrastPairs } from "./demos";
import { FurnitureSpread } from "./furniture";
import { Head } from "./head";
import { KitSpread } from "./kit";
import s from "./specimen.module.css";

export const metadata: Metadata = {
  title: "Kit specimen — Nick Lukashik",
  robots: { index: false, follow: false },
};

/* An internal page in English: literal strings, no messages. */

const contents = [
  { href: "#levels", title: "Two levels", page: "2" },
  { href: "#faces", title: "Eight faces", page: "4" },
  { href: "#inks", title: "Inks and contrast", page: "6" },
  { href: "#kit", title: "The kit, part by part", page: "8" },
  { href: "#furniture", title: "Magazine furniture", page: "14" },
];

const faces = [
  {
    variable: "--font-body",
    face: "Old Standard TT",
    job: "Loud body text, an old magazine column",
    min: "17 px, line height 1.55",
    sample: "Сделано от и до — built start to finish.",
  },
  {
    variable: "--font-mast",
    face: "Ruslan Display",
    job: "Masthead, drop caps, big numbers",
    min: "28 px and up",
    sample: "Выпуск № 2",
  },
  {
    variable: "--font-sign",
    face: "Unbounded Black",
    job: "Headlines and signs; calm-level headings",
    min: "16 px; −0.02 em when large",
    sample: "Причал № 1",
  },
  {
    variable: "--font-tabloid",
    face: "Playfair Display Black Italic",
    job: "Accents and tabloid kickers",
    min: "18 px",
    sample: "Сенсация! Hot news!",
  },
  {
    variable: "--font-loud",
    face: "Rubik Mono One",
    job: "Loud caps: buttons and kickers",
    min: "11 px, caps, two or three words",
    sample: "Записаться · book",
  },
  {
    variable: "--font-stamp",
    face: "Rubik Dirt",
    job: "Rubber stamps, a word or two",
    min: "22 px, caps",
    sample: "Оплачено",
  },
  {
    variable: "--font-type",
    face: "PT Mono",
    job: "Typewriter labels, captions, code",
    min: "12 px",
    sample: "стр. 4 · p. 4 · 0O 1lI",
  },
  {
    variable: "--font-hand",
    face: "Caveat",
    job: "Notes in the margins",
    min: "20 px",
    sample: "загляни на стр. 12 →",
  },
];

const retired = [
  { variable: "--font-kitsch", was: "Lobster", now: "--font-tabloid" },
  { variable: "--font-drip", was: "Rubik Wet Paint", now: "--font-stamp" },
  { variable: "--font-glitch", was: "Rubik Glitch", now: "--font-stamp" },
  { variable: "--font-pixel", was: "Press Start 2P", now: "--font-loud" },
  { variable: "--font-marker", was: "Pangolin", now: "--font-hand" },
];

const swatches = [
  "--paper",
  "--paper-white",
  "--paper-deep",
  "--ink",
  "--ink-soft",
  "--spot-red",
  "--spot-red-deep",
  "--spot-blue",
  "--spot-yellow",
  "--spot-green",
  "--spot-pink",
];

const dayPairs: ContrastPair[] = [
  { fg: "--foreground", bg: "--background", use: "body text", min: 4.5 },
  { fg: "--muted-foreground", bg: "--secondary", use: "quiet text", min: 4.5 },
  { fg: "--primary-foreground", bg: "--primary", use: "button", min: 4.5 },
  {
    fg: "--primary-foreground",
    bg: "--destructive",
    use: "danger button",
    min: 4.5,
  },
  { fg: "--danger", bg: "--background", use: "error text", min: 4.5 },
  { fg: "--danger", bg: "--danger-soft", use: "error note", min: 4.5 },
  { fg: "--ok", bg: "--surface", use: "success text", min: 4.5 },
  { fg: "--ok", bg: "--ok-soft", use: "success note", min: 4.5 },
  { fg: "--warn", bg: "--background", use: "warning text", min: 4.5 },
  { fg: "--warn", bg: "--warn-soft", use: "warning note", min: 4.5 },
  { fg: "--info", bg: "--secondary", use: "info text", min: 4.5 },
  { fg: "--info", bg: "--info-soft", use: "info note", min: 4.5 },
  { fg: "--spot-blue", bg: "--background", use: "margin notes", min: 4.5 },
  { fg: "--ink", bg: "--spot-yellow", use: "highlighter", min: 4.5 },
  { fg: "--spot-red", bg: "--background", use: "large accents", min: 3 },
];

const nightPairs: ContrastPair[] = [
  { fg: "--foreground", bg: "--background", use: "body text", min: 4.5 },
  { fg: "--muted-foreground", bg: "--surface", use: "quiet text", min: 4.5 },
  { fg: "--primary-foreground", bg: "--primary", use: "button", min: 4.5 },
  { fg: "--ok", bg: "--surface", use: "success text", min: 4.5 },
  { fg: "--warn", bg: "--surface", use: "warning text", min: 4.5 },
  { fg: "--danger", bg: "--surface", use: "error text", min: 4.5 },
  { fg: "--danger", bg: "--danger-soft", use: "error note", min: 4.5 },
  { fg: "--info", bg: "--surface", use: "info text", min: 4.5 },
  { fg: "--ring", bg: "--background", use: "focus ring", min: 3 },
];

function LevelSample({
  theme,
  name,
  children,
}: {
  theme: "zine" | "zine-calm";
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div data-theme={theme} className={s.level}>
      <div className={s.levelHead}>
        <span className={s.levelName}>{name}</span>
        <code className={s.code}>data-theme="{theme}"</code>
      </div>
      <p className="og-eyebrow">Battleship · night sea</p>
      <h3 className={s.sub}>
        Your move, <span className="og-accent">captain</span>
      </h3>
      <p className={s.levelBody}>{children}</p>
      <div className={s.row}>
        <Button>Fire</Button>
        <Button variant="outline">Pass</Button>
        <Button variant="ghost">Rules</Button>
      </div>
      <div className={s.field}>
        <Label htmlFor={`${theme}-board`}>Board name</Label>
        <Input
          id={`${theme}-board`}
          name={`${theme}-board`}
          defaultValue="Night sea"
          autoComplete="off"
        />
      </div>
      <ul className={s.row}>
        <li>
          <Badge>Ranked</Badge>
        </li>
        <li>
          <Badge>Bot: hard</Badge>
        </li>
        <li>
          <Badge>14 games</Badge>
        </li>
      </ul>
      <Notice tone="warning" title="Your opponent went offline">
        The board waits for them for 24 hours.
      </Notice>
    </div>
  );
}

export default function Specimen() {
  // The calm islands read in the kit's Manrope (zine.css sets --font-body to
  // it at the calm level). The landing leaves the kit's faces off <html>, so
  // the page that shows them brings them, and only it preloads them.
  return (
    <main className={`${s.page} og-container ${fontVariables}`} lang="en">
      <div className={s.top}>
        <a href="/" className={s.back}>
          <ArrowLeftIcon aria-hidden="true" /> outegro.dev
        </a>
        <span className="og-eyebrow">Not indexed · for the workshop</span>
      </div>
      <p className={s.strip}>
        <span>@outegro/ui · the zine theme</span>
        <span>Issue 2 · two levels · eight faces · AA inks</span>
      </p>
      <h1 className={s.mast}>Kit specimen</h1>
      <p className={s.tagline}>every part of the kit, loud and calm</p>

      <div className={s.intro}>
        <p className={`${s.lead} ${s.dropcap}`}>
          The shared kit in its zine theme, laid out like a type foundry's
          specimen. The landing wears it loud: crooked caps buttons, stamps and
          typewriter fields. Product apps wear it calm: the same paper, inks and
          headline faces, a sans body that reads for an hour, and controls that
          stay straight.
        </p>
        <nav className={s.contents} aria-labelledby="contents-title">
          <h2 id="contents-title" className={s.contentsTitle}>
            In this issue
          </h2>
          <ol>
            {contents.map((item) => (
              <li key={item.href}>
                <a href={item.href}>
                  <span className={s.contentsName}>{item.title}</span>
                  <span className={s.dots} aria-hidden="true" />
                  <span className={s.pageNo}>
                    <span className="sr-only">page </span>
                    {item.page}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <section id="levels" className={s.spread} aria-labelledby="levels-title">
        <Head kicker="p. 2 · levels" id="levels-title" title="Two levels">
          <p className={s.note}>
            One token block, two looks. Put{" "}
            <code className={s.code}>data-theme</code> on{" "}
            <code className={s.code}>&lt;html&gt;</code>; a calm island can sit
            inside a loud page, not the other way round.
          </p>
        </Head>
        <div className={s.grid2}>
          <LevelSample theme="zine" name="Loud">
            For the landing: cut-out buttons glued on crooked, labels typed on a
            typewriter, fields on a ruled line, a little bounce.
          </LevelSample>
          <LevelSample theme="zine-calm" name="Calm">
            For the apps people work in: the same paper and inks, headlines in
            the sign face, a sans body at 16/1.6 and controls that stay put.
          </LevelSample>
        </div>
      </section>

      <section id="faces" className={s.spread} aria-labelledby="faces-title">
        <Head kicker="p. 4 · type" id="faces-title" title="Eight faces">
          <p className={s.note}>
            Thirteen faces were too many to read. Eight are left, each with one
            job and a smallest size it still reads at. Both scripts come from
            the same family.
          </p>
        </Head>
        <div className={s.faces}>
          {faces.map((face) => (
            <article key={face.variable} className={s.face}>
              <p
                className={s.glyphs}
                style={{ fontFamily: `var(${face.variable})` }}
                aria-hidden="true"
              >
                Аа Rr
              </p>
              <p
                className={s.faceLine}
                style={{ fontFamily: `var(${face.variable})` }}
              >
                {face.sample}
              </p>
              <div className={s.meta}>
                <span>
                  {face.face} · <code>{face.variable}</code>
                </span>
                <span>{face.job}</span>
                <span>From {face.min}</span>
              </div>
            </article>
          ))}
          <article data-theme="zine-calm" className={s.face}>
            <p className={s.glyphs} aria-hidden="true">
              Аа Rr
            </p>
            <p className={s.faceLine}>
              Сделано от и до — built start to finish.
            </p>
            <div className={s.meta}>
              <span>
                Manrope · <code>--font-body</code> at the calm level
              </span>
              <span>Body text and controls in the apps</span>
              <span>From 14 px; 16 px with line height 1.6 to read</span>
            </div>
          </article>
        </div>

        <div className={`${s.grid2} mt-12`}>
          <div className={s.clip}>
            <h3 className={s.sub}>Retired, names kept</h3>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Variable</th>
                  <th scope="col">Was</th>
                  <th scope="col">Now set in</th>
                </tr>
              </thead>
              <tbody>
                {retired.map((row) => (
                  <tr key={row.variable}>
                    <td>
                      <code>{row.variable}</code>
                    </td>
                    <td>{row.was}</td>
                    <td style={{ fontFamily: `var(${row.now})` }}>{row.now}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={s.clip}>
            <h3 className={s.sub}>Reading at both levels</h3>
            <p className={s.caption}>Loud · Old Standard 17/1.55</p>
            <div className={`${s.reading} ${s.readLoud}`}>
              <p>
                Battleship is a real product: sign-in, rated games against
                friends and a bot, payments and an admin.
              </p>
            </div>
            <p className={s.caption}>Calm · Manrope 16/1.6</p>
            <div data-theme="zine-calm" className={s.reading}>
              <p>
                Battleship is a real product: sign-in, rated games against
                friends and a bot, payments and an admin.
              </p>
              <p lang="ru">
                Морской бой — настоящий продукт: вход, рейтинговые партии с
                друзьями и ботом, оплата и админка.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="inks" className={s.spread} aria-labelledby="inks-title">
        <Head kicker="p. 6 · colour" id="inks-title" title="Inks and contrast">
          <p className={s.note}>
            Spot colours print the look; the status inks are the same hues taken
            down until they read as small text. Every ratio below is measured in
            your browser from the live stylesheet.
          </p>
        </Head>
        <ul className={s.swatches}>
          {swatches.map((token) => (
            <li key={token} className={s.swatch}>
              <span
                className={s.chip}
                style={{ background: `var(${token})` }}
                aria-hidden="true"
              />
              <code>{token}</code>
            </li>
          ))}
        </ul>
        <div className={`${s.grid2} mt-12`}>
          <div className={s.clip}>
            <h3 className={s.sub}>By day</h3>
            <ContrastPairs pairs={dayPairs} />
          </div>
          <div data-tone="dark" className={s.night}>
            <h3 className={s.sub}>At night</h3>
            <ContrastPairs pairs={nightPairs} />
          </div>
        </div>
      </section>

      <KitSpread />

      <FurnitureSpread />
    </main>
  );
}
