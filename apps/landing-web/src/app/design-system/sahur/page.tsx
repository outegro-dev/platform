import type { Metadata } from "next";
import { Storyboard } from "./storyboard";

export const metadata: Metadata = {
  title: "Sahur — Nick Lukashik",
  robots: { index: false, follow: false },
};

// The bonk choreography frame by frame, to tune poses without replaying it.
export default function Sahur() {
  return (
    <main className="og-container section-space">
      <Storyboard />
    </main>
  );
}
