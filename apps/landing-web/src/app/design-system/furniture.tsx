import { Button } from "@outegro/ui/button";
import { Barcode, PriceTag, StampMark, Ticker } from "@/components/zine/bits";
import { Coupon } from "@/components/zine/coupon";
import { generator, seed, tilt } from "@/components/zine/random";
import { Ransom } from "@/components/zine/ransom";
import { Receipt } from "@/components/zine/receipt";
import { TearOffs } from "@/components/zine/tear-offs";
import { contacts } from "@/lib/contact";
import { Head } from "./head";
import s from "./specimen.module.css";

const telegram = contacts.find((c) => c.key === "telegram") ?? contacts[0];

const ads = [
  {
    title: "Products from scratch",
    body: "From the first sketch to a paid product with sign-in, payments and an admin.",
  },
  {
    title: "A second pair of hands",
    body: "Joins your team for a quarter: features, reviews, the boring parts too.",
  },
  {
    title: "Rescue",
    body: "The app is slow, the deploy is scary. Finds out why and fixes it.",
  },
];

/** A seeded crooked angle, the same on every render. */
const crooked = (key: string, max = 2.4) =>
  ({
    "--tilt": `${tilt(generator(seed(key)), max)}deg`,
  }) as React.CSSProperties;

/** Pieces of the landing itself; loud only, they are not part of the kit. */
export function FurnitureSpread() {
  return (
    <section
      id="furniture"
      className={s.spread}
      aria-labelledby="furniture-title"
    >
      <Head
        kicker="p. 14 · landing"
        id="furniture-title"
        title="Magazine furniture"
      >
        <p className={s.note}>
          Pieces of the landing itself, loud only: they live in the landing, not
          in the kit.
        </p>
      </Head>
      <div className={s.stack}>
        <Ticker
          label="Hot off the press"
          items={[
            "Two levels of one theme",
            "Eight faces instead of thirteen",
            "Every ink passes AA",
            "The kit, now with variants",
          ]}
        />

        <h3 className={s.sub}>Ransom letters</h3>
        <p className={s.ransomLine}>
          <Ransom text="Kit specimen" />
        </p>
        <p className={s.ransomSmall}>
          <Ransom text="Сделано от и до" />
        </p>

        <h3 className={s.sub}>Price tags</h3>
        <ol className="price-tags">
          <li style={crooked("tag-1", 3.5)}>
            <PriceTag price="$0" note="for a look" />
          </li>
          <li style={crooked("tag-2", 3.5)}>
            <PriceTag price="$40/h" was="$60/h">
              <h4 className="price-title">By the hour</h4>
              <p className="price-body">Small fixes and reviews.</p>
            </PriceTag>
          </li>
          <li style={crooked("tag-3", 3.5)}>
            <PriceTag price="Quote" note="per project">
              <h4 className="price-title">Turnkey</h4>
              <p className="price-body">From the sketch to production.</p>
            </PriceTag>
          </li>
        </ol>

        <h3 className={s.sub}>Stamps and barcodes</h3>
        <div className={s.sheet}>
          <StampMark text="Paid" />
          <StampMark text="Live" tone="blue" />
          <StampMark text="Shipped" />
          <StampMark text="Approved" tone="blue" />
          <Barcode code="4 607001 770011" />
          <Barcode code="0002-OUTEGRO-KIT" />
        </div>

        <div className={s.grid2}>
          <div>
            <h3 className={s.sub}>Receipt</h3>
            <Receipt
              title="Outegro kit"
              number="No. 0002"
              items={[
                { title: "Tokens", body: "Paper, inks, radii, shadows." },
                { title: "Faces", body: "Eight, each with one job." },
                { title: "Components", body: "Loud and calm." },
              ]}
              included="incl."
              total="Total"
              totalValue="one kit"
              thanks="Thank you for reading"
              stamp="Paid"
            />
          </div>
          <div>
            <h3 className={s.sub}>A clipping</h3>
            <div className={s.pinned}>
              <span className={`tape ${s.pinnedTape}`} aria-hidden="true" />
              <p className="burst">
                <b>New!</b>
                <span>two levels inside</span>
              </p>
              <p className={s.margin}>pasted in with tape →</p>
              <p className="mt-4 max-w-[34ch]">
                A clipping holds a quote, a photo or a note; the burst shouts
                the one thing that is new.
              </p>
            </div>
          </div>
        </div>

        <h3 className={s.sub}>Classifieds with tear-off strips</h3>
        <ol className="ads">
          {ads.map((ad, i) => (
            <li
              key={ad.title}
              className={`ad is-${i}`}
              style={crooked(ad.title, 1.2)}
            >
              <div className="ad-sheet">
                <h4 className="ad-title">{ad.title}</h4>
                <p className="ad-body">{ad.body}</p>
              </div>
              <TearOffs
                href={telegram.href}
                handle={telegram.handle}
                seedText={ad.title}
              />
            </li>
          ))}
        </ol>

        <h3 className={s.sub}>Coupon</h3>
        <Coupon
          title="Coupon"
          offer="A 30-minute call, free"
          fine="Cut along the dashed line. One per reader."
          cut="Cut it out"
          done="Cut! Now it is yours."
          action={
            <Button asChild size="lg">
              <a href="#furniture">Book a call</a>
            </Button>
          }
        >
          <p className={s.margin}>the contacts sit under the coupon</p>
        </Coupon>
      </div>
    </section>
  );
}
