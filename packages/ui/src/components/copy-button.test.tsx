import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CopyButton,
  type CopyButtonProps,
  type CopyStatus,
  copyText,
  createCopyFeedback,
} from "./copy-button";

/** The browser's clipboard as the page sees it; nothing at all when insecure. */
function clipboard(writeText?: (text: string) => Promise<void>) {
  const spy = writeText ? vi.fn(writeText) : undefined;
  vi.stubGlobal("navigator", spy ? { clipboard: { writeText: spy } } : {});
  return spy;
}

const denied = () =>
  Promise.reject(
    new DOMException("Write permission denied.", "NotAllowedError"),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("copyText", () => {
  it("writes the text and resolves true", async () => {
    const write = clipboard(async () => {});
    await expect(copyText("pnpm --filter @outegro/ui test")).resolves.toBe(
      true,
    );
    expect(write).toHaveBeenCalledWith("pnpm --filter @outegro/ui test");
  });

  it("reads a function value at the moment of the copy", async () => {
    const write = clipboard(async () => {});
    let text = "draft";
    const read = () => text;
    text = "final";
    await copyText(read);
    expect(write).toHaveBeenCalledWith("final");
  });

  it("resolves false without the Clipboard API (insecure context)", async () => {
    clipboard();
    await expect(copyText("x")).resolves.toBe(false);
  });

  it("resolves false when the permission is denied", async () => {
    clipboard(denied);
    await expect(copyText("x")).resolves.toBe(false);
  });

  it("resolves false when reading the value throws", async () => {
    const write = clipboard(async () => {});
    await expect(
      copyText(() => {
        throw new Error("editor gone");
      }),
    ).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("createCopyFeedback", () => {
  beforeEach(() => vi.useFakeTimers());

  const track = () => {
    const seen: CopyStatus[] = [];
    return { seen, feedback: createCopyFeedback((s) => seen.push(s)) };
  };

  it("reports copied, then idle after two seconds", async () => {
    clipboard(async () => {});
    const { seen, feedback } = track();
    await expect(feedback.copy("x")).resolves.toBe("copied");
    expect(seen).toEqual(["copied"]);
    vi.advanceTimersByTime(1999);
    expect(seen).toEqual(["copied"]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(["copied", "idle"]);
  });

  it("reports failed when the clipboard refuses, then idle", async () => {
    clipboard(denied);
    const { seen, feedback } = track();
    await expect(feedback.copy("x")).resolves.toBe("failed");
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual(["failed", "idle"]);
  });

  it("restarts the reset timer on every copy", async () => {
    clipboard(async () => {});
    const { seen, feedback } = track();
    await feedback.copy("a");
    vi.advanceTimersByTime(1500);
    await feedback.copy("b");
    vi.advanceTimersByTime(1500);
    expect(seen).toEqual(["copied", "copied"]);
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(["copied", "copied", "idle"]);
  });

  it("honours a custom reset delay", async () => {
    clipboard(async () => {});
    const { seen, feedback } = track();
    await feedback.copy("x", 500);
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(["copied", "idle"]);
  });

  it("lets the newest copy win over a slower one still in flight", async () => {
    let refuse = () => {};
    const write = clipboard(async () => {});
    write?.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          refuse = () => reject(new DOMException("Late", "NotAllowedError"));
        }),
    );
    const { seen, feedback } = track();
    const slow = feedback.copy("old");
    await feedback.copy("new");
    refuse();
    await expect(slow).resolves.toBe("failed");
    expect(seen).toEqual(["copied"]);
  });

  it("reports nothing after dispose", async () => {
    let finish = () => {};
    const write = clipboard(async () => {});
    const { seen, feedback } = track();
    await feedback.copy("x");
    feedback.dispose();
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual(["copied"]);

    write?.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const late = feedback.copy("y");
    feedback.dispose();
    finish();
    await late;
    expect(seen).toEqual(["copied"]);
  });
});

describe("CopyButton", () => {
  const render = (props: Partial<CopyButtonProps> = {}) =>
    renderToStaticMarkup(
      <CopyButton
        value="npm create outegro"
        label="Copy"
        copiedLabel="Copied"
        failedLabel="Couldn't copy"
        {...props}
      />,
    );

  it("is a plain button named by the visible pair, with room for the others", () => {
    const html = render();
    expect(html).toMatch(
      /^<button data-slot="copy-button"[^>]*data-state="idle"[^>]*type="button">/,
    );
    // One grid cell holds every icon-and-label pair: the widest sets the
    // width; the hidden ones keep their space but leave the name.
    expect(html).toContain(
      '<span data-slot="copy-button-content" class="grid gap-[inherit] *:col-start-1 *:row-start-1">',
    );
    const pair = (state: string) =>
      html.match(
        new RegExp(
          `<span data-state="${state}" class="([^"]*)"><svg[^>]*>.*?</svg><span>([^<]*)</span></span>`,
        ),
      );
    expect(pair("idle")?.slice(1)).toEqual([
      "inline-flex items-center justify-center gap-[inherit]",
      "Copy",
    ]);
    expect(pair("copied")?.slice(1)).toEqual([
      "inline-flex items-center justify-center gap-[inherit] invisible",
      "Copied",
    ]);
    expect(pair("failed")?.slice(1)).toEqual([
      "inline-flex items-center justify-center gap-[inherit] invisible",
      "Couldn&#x27;t copy",
    ]);
  });

  it("hides its icons from assistive technology", () => {
    const svgs = render().match(/<svg[^>]*>/g) ?? [];
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) expect(svg).toContain('aria-hidden="true"');
  });

  it("keeps an empty polite live region next to the button", () => {
    expect(render()).toMatch(
      /<\/button><span role="status" data-slot="copy-button-status" class="sr-only"><\/span>$/,
    );
  });

  it("passes the Button variant and size through", () => {
    const html = render({ variant: "outline", size: "md" });
    expect(html).toContain('data-variant="outline"');
    expect(html).toContain("h-12");
    expect(render()).toContain('data-variant="ghost"');
  });

  it("keeps the labels as the name of an icon-only button", () => {
    const html = render({ size: "icon-sm" });
    expect(html).toMatch(/<\/svg><span class="sr-only">Copy<\/span>/);
    expect(html).toMatch(/<\/svg><span class="sr-only">Copied<\/span>/);
  });

  it("stays a button even inside a form", () => {
    expect(render()).not.toContain('type="submit"');
  });
});
