import type { Metadata } from "next";
import { unlisted } from "@/lib/metadata";
import { Storyboard } from "./storyboard";

export const metadata: Metadata = unlisted({
  title: "Sahur — Nick Lukashik",
  description: "The 504 joke's choreography, frame by frame.",
});

// The bonk choreography frame by frame, to tune poses without replaying it.
export default function Sahur() {
  return (
    <main className="og-container section-space">
      <Storyboard />
    </main>
  );
}
