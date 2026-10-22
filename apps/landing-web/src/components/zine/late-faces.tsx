import { headers } from "next/headers";
import { FacesWait } from "./faces-wait";

// the paint as it is reported, not hydration, which comes seconds after it
// on a slow phone
const release = [
  'PerformanceObserver.supportedEntryTypes.includes("paint")&&',
  "new PerformanceObserver((list,observer)=>{",
  'if(list.getEntriesByName("first-contentful-paint").length===0)return;',
  "observer.disconnect();",
  'document.querySelector("[data-faces-wait]")?.removeAttribute("data-faces-wait")',
  '}).observe({type:"paint",buffered:true})',
].join("");

/**
 * Holds the zine faces back until the first contentful paint is out:
 * zine-page.css keeps them on their sized fallbacks while the marker
 * (FacesWait) carries its attribute, so that paint does not queue behind
 * their files. This nonced script takes the attribute off at that paint;
 * where paints go unreported, the marker goes once the page has loaded.
 */
export async function LateFaces() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <FacesWait />
      <script
        nonce={nonce}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script with no input.
        dangerouslySetInnerHTML={{ __html: release }}
      />
    </>
  );
}
