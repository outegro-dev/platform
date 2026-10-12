"use client";

import { AccountMenu } from "@outegro/ui/account-menu";
import { Button } from "@outegro/ui/button";
import { CopyButton } from "@outegro/ui/copy-button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import { LanguageSwitch } from "@outegro/ui/language-switch";
import { productionPlatformUrls } from "@outegro/ui/lib/platform";
import { Progress } from "@outegro/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@outegro/ui/toggle-group";
import { createContext, use, useEffect, useId, useRef, useState } from "react";
import s from "./specimen.module.css";

type Level = "zine" | "zine-calm";

/** The level the kit spread is shown at; dialogs open at <body>, so they ask. */
const LevelContext = createContext<Level>("zine");

/**
 * Shows everything inside at one level of the zine theme: a calm island
 * (data-theme="zine-calm") on this loud page, or the loud page itself.
 */
export function LevelSwitch({ children }: { children: React.ReactNode }) {
  const id = useId();
  const [level, setLevel] = useState<Level>("zine");
  return (
    <LevelContext value={level}>
      <div className={s.switchBar}>
        <span id={id} className={s.switchLabel}>
          Level
        </span>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          value={level}
          onValueChange={(next) => setLevel(next as Level)}
          aria-labelledby={id}
        >
          <ToggleGroupItem value="zine">Loud</ToggleGroupItem>
          <ToggleGroupItem value="zine-calm">Calm</ToggleGroupItem>
        </ToggleGroup>
        <code className={s.code}>data-theme="{level}"</code>
      </div>
      <div data-theme={level} className={s.kit}>
        {children}
      </div>
    </LevelContext>
  );
}

/**
 * A confirmation and a plain message, both at the level of the spread. They
 * open at <body>, outside the page's font variables, so they carry the kit's
 * faces (`fonts`, from @outegro/ui/fonts) for the calm level's Manrope.
 */
export function DialogDemo({ fonts }: { fonts: string }) {
  const level = use(LevelContext);
  return (
    <div className={s.row}>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="destructive">Delete the board</Button>
        </DialogTrigger>
        <DialogContent data-theme={level} className={fonts} closeLabel="Close">
          <DialogHeader>
            <DialogTitle>Delete “Night sea”?</DialogTitle>
            <DialogDescription>
              The board and its 14 saved games are gone for good. Your opponents
              keep their results.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Keep it</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button variant="destructive">Delete</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">What is new</Button>
        </DialogTrigger>
        <DialogContent data-theme={level} className={fonts} closeLabel="Close">
          <DialogHeader>
            <DialogTitle>Issue 2 is out</DialogTitle>
            <DialogDescription>
              Payments moved to one page, receipts come by email, and the night
              sea is back on the board.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Got it</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const person = {
  name: "Nick Lukashik",
  email: "nick@outegro.test",
  roles: [],
};

/** The platform menu signed in or out; sign-out stays on this page. */
export function AccountMenuDemo({
  signedIn,
  compact = false,
}: {
  signedIn: boolean;
  compact?: boolean;
}) {
  return (
    <AccountMenu
      user={signedIn ? person : null}
      current="battleship"
      urls={productionPlatformUrls}
      locale="en"
      signInHref="#account"
      signOut="#account"
      onSignOutSubmit={(event) => event.preventDefault()}
      compact={compact}
    />
  );
}

const languages = [
  { value: "en", label: "EN", name: "English" },
  { value: "ru", label: "RU", name: "Русский" },
] as const;

/** The language switch on local state: it changes nothing on the site. */
export function LanguageSwitchDemo() {
  const [value, setValue] = useState("en");
  return (
    <LanguageSwitch
      aria-label="Language"
      value={value}
      options={languages}
      onValueChange={setValue}
    />
  );
}

/** A segmented control driving a progress bar: the fill slides, never resizes. */
export function ProgressDemo() {
  const id = useId();
  const [value, setValue] = useState(40);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id={id} className="text-sm font-medium">
          Chapter read
        </span>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          value={String(value)}
          onValueChange={(next) => setValue(Number(next))}
          aria-labelledby={id}
        >
          {[0, 40, 75, 100].map((option) => (
            <ToggleGroupItem key={option} value={String(option)}>
              {option}%
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <Progress
        aria-labelledby={id}
        value={value}
        valueText={`${value}%`}
        tone={value >= 100 ? "ok" : "accent"}
      />
    </div>
  );
}

/**
 * A small button that is busy: the spinner covers the kept label, the size
 * and the 44 px target stay. (Pending guards clicks with a handler, so it
 * renders on the client.)
 */
export function PendingButton() {
  return (
    <Button size="sm" variant="outline" pending pendingLabel="Saving…">
      Save
    </Button>
  );
}

/** A clipboard that refuses: the value cannot be read, so the copy fails. */
export function RefusedCopy() {
  return (
    <CopyButton
      variant="outline"
      label="Copy"
      copiedLabel="Copied"
      failedLabel="Couldn't copy"
      value={() => {
        throw new Error("Clipboard unavailable in this demo");
      }}
    />
  );
}

export type ContrastPair = {
  /** Text colour token, e.g. "--danger". */
  fg: string;
  /** Background token. */
  bg: string;
  /** Where the pair is used. */
  use: string;
  /** 4.5 for text, 3 for large text and parts of controls. */
  min: 3 | 4.5;
};

/**
 * Contrast of token pairs, measured from the computed colours in this
 * browser, so the list cannot drift from the stylesheet.
 */
export function ContrastPairs({ pairs }: { pairs: ContrastPair[] }) {
  const list = useRef<HTMLUListElement>(null);
  const [ratios, setRatios] = useState<number[]>([]);
  useEffect(() => {
    const samples =
      list.current?.querySelectorAll<HTMLElement>("[data-sample]") ?? [];
    setRatios(
      [...samples].map((sample) => {
        const style = getComputedStyle(sample);
        return contrast(style.color, style.backgroundColor);
      }),
    );
  }, []);
  return (
    <ul ref={list} className={s.pairs}>
      {pairs.map((pair, i) => {
        const ratio = ratios[i];
        return (
          <li key={`${pair.fg}-${pair.bg}`} className={s.pair}>
            <span
              data-sample
              // a 3:1 pair is for large text only, so it is shown large
              data-large={pair.min === 3 || undefined}
              className={s.sample}
              style={{
                color: `var(${pair.fg})`,
                background: `var(${pair.bg})`,
              }}
            >
              Аа Aa 123
            </span>
            <span className={s.pairName}>
              {pair.fg} on {pair.bg} · {pair.use}
            </span>
            <span className={s.ratio}>
              {ratio === undefined ? "…" : `${ratio.toFixed(2)} : 1`}
            </span>
            {ratio === undefined ? null : (
              <span className={s.verdict} data-pass={ratio >= pair.min}>
                {ratio >= pair.min ? `AA ${pair.min}` : `below ${pair.min}`}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** WCAG contrast ratio of two computed colours ("rgb(…)" or "rgba(…)"). */
function contrast(a: string, b: string) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(color: string) {
  const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).map(Number);
  const [lr = 0, lg = 0, lb = 0] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}
