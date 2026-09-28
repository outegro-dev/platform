import type { Metadata } from "next";
import knotPoster from "@/assets/knot.webp";
import signaturePoster from "@/assets/signature.webp";
import wavePoster from "@/assets/wave.webp";
import { SilverStage } from "@/components/silver/silver-stage";

export const metadata: Metadata = {
  title: "Scenes — Nick Lukashik",
  robots: { index: false, follow: false },
};

// Frozen frames of every live scene. tools/quality/render-posters.mjs
// screenshots these at 2x to produce the posters, so posters always match 3D.
export default function Scenes() {
  return (
    <main className="scenes">
      <div id="scene-signature" className="scene-frame scene-signature">
        <SilverStage
          kind="signature"
          poster={signaturePoster}
          alt=""
          sizes="1100px"
          still={5.2}
        />
      </div>
      <div id="scene-knot" className="scene-frame scene-knot">
        <SilverStage
          kind="knot"
          poster={knotPoster}
          alt=""
          sizes="800px"
          still={3.4}
        />
      </div>
      <div id="scene-wave" className="scene-frame scene-wave">
        <SilverStage
          kind="wave"
          poster={wavePoster}
          alt=""
          sizes="1600px"
          still={2.6}
        />
      </div>
    </main>
  );
}
