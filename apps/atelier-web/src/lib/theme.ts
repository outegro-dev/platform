/* The theme choice, shared by the server (layout) and the switch. */

export type ThemeChoice = "system" | "light" | "dark";

export function themeChoiceOf(value: string | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Runs in <head> before the first paint: the dark tone of the zine theme
 * for a dark choice, or for "system" while the system is dark (and again
 * whenever the system changes). The server only renders the choice.
 */
export const themeScript = `(function(){try{var d=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)");var a=function(){var c=d.getAttribute("data-theme-choice");var dark=c==="dark"||(c!=="light"&&m.matches);if(dark)d.setAttribute("data-tone","dark");else d.removeAttribute("data-tone")};a();m.addEventListener("change",a);window.__atelierTheme=a}catch(e){}})()`;
