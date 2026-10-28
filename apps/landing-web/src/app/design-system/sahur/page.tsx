import type { Metadata } from "next";
import { unlisted } from "@/lib/metadata";
import { Storyboard } from "./storyboard";

export const metadata: Metadata = unlisted({
  title: "Sahur — Nick Lukashik",
  description: "Tung Tung Tung Sahur's cameo, frame by frame.",
});

// The cameo frame by frame, to tune poses without replaying it.
export default function Sahur() {
  return (
    <main className="og-container section-space">
      <Storyboard />
    </main>
  );
}
