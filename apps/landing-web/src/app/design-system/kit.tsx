import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@outegro/ui/accordion";
import { AccountMenuPlaceholder } from "@outegro/ui/account-menu";
import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { CopyButton } from "@outegro/ui/copy-button";
import { fontVariables } from "@outegro/ui/fonts";
import { FormMessage } from "@outegro/ui/form-message";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { Notice, StatePanel } from "@outegro/ui/notice";
import { Progress } from "@outegro/ui/progress";
import { Skeleton } from "@outegro/ui/skeleton";
import { Spinner } from "@outegro/ui/spinner";
import { Surface } from "@outegro/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@outegro/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@outegro/ui/toggle-group";
import type { Icon } from "@phosphor-icons/react";
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  CalendarIcon,
  CloudSlashIcon,
  FloppyDiskIcon,
  FunnelIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import { StampMark } from "@/components/zine/bits";
import {
  AccountMenuDemo,
  DialogDemo,
  LanguageSwitchDemo,
  LevelSwitch,
  PendingButton,
  ProgressDemo,
  RefusedCopy,
} from "./demos";
import { Head } from "./head";
import s from "./specimen.module.css";

const buttonVariants: {
  variant:
    | "primary"
    | "secondary"
    | "outline"
    | "glass"
    | "ghost"
    | "destructive"
    | "link";
  label: string;
  icon?: Icon;
}[] = [
  { variant: "primary", label: "Book a call", icon: CalendarIcon },
  { variant: "secondary", label: "Save draft", icon: FloppyDiskIcon },
  { variant: "outline", label: "Read on", icon: ArrowRightIcon },
  { variant: "glass", label: "Filters", icon: FunnelIcon },
  { variant: "ghost", label: "Cancel", icon: XIcon },
  { variant: "destructive", label: "Delete", icon: TrashIcon },
  { variant: "link", label: "Terms of sale" },
];

// Outlines the invisible ::after that takes compact controls to 44 px.
const showTargets =
  "[&_[data-slot=button]]:after:outline-1 [&_[data-slot=button]]:after:outline-dashed [&_[data-slot=button]]:after:outline-ring/60 [&_[data-slot=toggle-group-item]]:after:outline-1 [&_[data-slot=toggle-group-item]]:after:outline-dashed [&_[data-slot=toggle-group-item]]:after:outline-ring/60";

/** Every kit component and its variants, at the level picked in the switch. */
export function KitSpread() {
  return (
    <section id="kit" className={s.spread} aria-labelledby="kit-title">
      <Head
        kicker="p. 8 · components"
        id="kit-title"
        title={
          <>
            The kit, <em>part by part</em>
          </>
        }
      >
        <p className={s.note}>
          Flip the level: everything below re-prints. Dialogs open at the page
          root, so they are handed the level explicitly.
        </p>
      </Head>

      <LevelSwitch>
        <section id="buttons" aria-labelledby="buttons-title">
          <Head
            kicker="buttons"
            id="buttons-title"
            level={3}
            title="Seven variants, five sizes"
          />
          <div className={`${s.clip} ${s.variants}`}>
            {buttonVariants.map(({ variant, label, icon: Glyph }) => (
              <div key={variant} className={s.variant}>
                <span className={s.variantName}>{variant}</span>
                <div className={s.row}>
                  <Button variant={variant} size="sm">
                    {label}
                  </Button>
                  <Button variant={variant}>{label}</Button>
                  <Button variant={variant} size="lg">
                    {label}
                  </Button>
                  {Glyph ? (
                    <>
                      <Button variant={variant} size="icon" aria-label={label}>
                        <Glyph />
                      </Button>
                      <Button
                        variant={variant}
                        size="icon-sm"
                        aria-label={label}
                      >
                        <Glyph />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
            <div className={s.variant}>
              <span className={s.variantName}>states</span>
              <div className={s.row}>
                <Button disabled>Disabled</Button>
                <PendingButton />
                <Button asChild variant="outline">
                  <a href="#badges">
                    Next: badges <ArrowRightIcon />
                  </a>
                </Button>
              </div>
            </div>
            <div className={s.variant}>
              <span className={s.variantName}>44 px targets</span>
              <div className={`${s.row} ${showTargets}`}>
                <Button size="sm">Small</Button>
                <Button size="icon-sm" variant="outline" aria-label="Filters">
                  <FunnelIcon />
                </Button>
                <ToggleGroup
                  type="single"
                  variant="segmented"
                  size="sm"
                  defaultValue="1"
                  aria-label="Speed"
                >
                  <ToggleGroupItem value="0.5">0.5×</ToggleGroupItem>
                  <ToggleGroupItem value="1">1×</ToggleGroupItem>
                  <ToggleGroupItem value="2">2×</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          </div>
        </section>

        <section id="badges" aria-labelledby="badges-title">
          <Head
            kicker="badges"
            id="badges-title"
            level={3}
            title="Labels and stamps"
          />
          <div className={s.grid2}>
            <div className={s.clip}>
              <p className={s.caption}>Variants</p>
              <ul className={s.row}>
                <li>
                  <Badge>outline</Badge>
                </li>
                <li>
                  <Badge variant="solid">solid</Badge>
                </li>
                <li>
                  <Badge variant="muted">muted</Badge>
                </li>
                <li>
                  <Badge variant="glass">glass</Badge>
                </li>
              </ul>
              <p className={s.caption}>A stack list</p>
              <ul className={s.row}>
                {[
                  "TypeScript",
                  "NestJS",
                  "PostgreSQL",
                  "Redis",
                  "K3s",
                  "Next.js",
                ].map((tech) => (
                  <li key={tech}>
                    <Badge>{tech}</Badge>
                  </li>
                ))}
              </ul>
            </div>
            <div className={s.clip}>
              <p className={s.caption}>Stamps (landing only)</p>
              <div className={s.row}>
                <StampMark text="Paid" />
                <StampMark text="Live" tone="blue" />
                <StampMark text="Draft" tone="blue" />
              </div>
            </div>
          </div>
        </section>

        <section id="fields" aria-labelledby="fields-title">
          <Head
            kicker="forms"
            id="fields-title"
            level={3}
            title="Fields and messages"
          />
          <div className={`${s.clip} ${s.grid2}`}>
            <div className={s.field}>
              <Label htmlFor="spec-email">Email</Label>
              <Input
                id="spec-email"
                name="spec-email"
                type="email"
                spellCheck={false}
                autoComplete="email"
                aria-describedby="spec-email-hint"
              />
              <FormMessage id="spec-email-hint">
                Receipts go here and nothing else.
              </FormMessage>
            </div>
            <div className={s.field}>
              <Label htmlFor="spec-board">Board name</Label>
              <Input
                id="spec-board"
                name="spec-board"
                defaultValue="N"
                autoComplete="off"
                aria-invalid
                aria-describedby="spec-board-error"
              />
              <FormMessage id="spec-board-error" tone="error">
                At least 3 letters, so friends can find it.
              </FormMessage>
            </div>
            <div className={s.field}>
              <Label htmlFor="spec-handle">Handle</Label>
              <Input
                id="spec-handle"
                name="spec-handle"
                defaultValue="night-sea"
                autoComplete="off"
                aria-describedby="spec-handle-ok"
              />
              <FormMessage id="spec-handle-ok" tone="success">
                It's free, it's yours.
              </FormMessage>
            </div>
            <div className={s.field}>
              <Label htmlFor="spec-promo">Promo code</Label>
              <Input
                id="spec-promo"
                name="spec-promo"
                disabled
                autoComplete="off"
                aria-describedby="spec-promo-wait"
              />
              <FormMessage id="spec-promo-wait" tone="pending">
                Checking your plan…
              </FormMessage>
            </div>
          </div>
        </section>

        <section id="dialogs" aria-labelledby="dialogs-title">
          <Head
            kicker="dialogs"
            id="dialogs-title"
            level={3}
            title="A page on top"
          >
            <p className={s.note}>
              The loud dialog is a torn-out page glued on crooked; the calm one
              sits straight. Both dim the page under a halftone screen.
            </p>
          </Head>
          <div className={s.clip}>
            <DialogDemo fonts={fontVariables} />
          </div>
        </section>

        <section id="notices" aria-labelledby="notices-title">
          <Head
            kicker="states"
            id="notices-title"
            level={3}
            title="Notices and state panels"
          />
          <div className={s.stack}>
            <div className={s.grid2}>
              <Notice>Saved games stay for a year.</Notice>
              <Notice tone="info" title="New: the night sea">
                Switch the board in the settings.
              </Notice>
              <Notice tone="success">
                Payment received. The receipt is in your email.
              </Notice>
              <Notice tone="warning" title="Your card expires in May">
                Update it before the next renewal.
              </Notice>
              <Notice
                tone="danger"
                title="The move did not go through"
                className={s.span2}
                actions={
                  <>
                    <Button size="sm">
                      <ArrowClockwiseIcon />
                      Try again
                    </Button>
                    <Button size="sm" variant="ghost">
                      Details
                    </Button>
                  </>
                }
              >
                The server took too long. Your board is safe.
              </Notice>
            </div>
            <div className={s.grid2}>
              <Surface>
                <StatePanel
                  as="div"
                  size="sm"
                  headingLevel={4}
                  title="No games yet"
                  description="Start one against a friend or the bot."
                  actions={
                    <Button size="sm" variant="outline">
                      New game
                    </Button>
                  }
                />
              </Surface>
              <Surface>
                <StatePanel
                  as="div"
                  size="sm"
                  headingLevel={4}
                  tone="warning"
                  icon={<CloudSlashIcon />}
                  title="You are offline"
                  description="Moves wait here and go out when you are back."
                />
              </Surface>
              <Surface className={s.span2}>
                <StatePanel
                  as="div"
                  headingLevel={4}
                  tone="danger"
                  title="The board failed to load"
                  description="Try again in a moment. If it keeps failing, write to us."
                  actions={
                    <Button size="lg" variant="outline">
                      <ArrowClockwiseIcon />
                      Try again
                    </Button>
                  }
                />
              </Surface>
            </div>
          </div>
        </section>

        <section id="tabs" aria-labelledby="tabs-title">
          <Head kicker="tabs" id="tabs-title" level={3} title="Line and pill" />
          <div className={`${s.clip} ${s.stack}`}>
            <Tabs defaultValue="analogy">
              <TabsList aria-label="Ways to read a chapter">
                <TabsTrigger value="analogy">Analogy</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
                <TabsTrigger value="diagram">Diagram</TabsTrigger>
                <TabsTrigger value="interview">Interview</TabsTrigger>
                <TabsTrigger value="deep" disabled>
                  Deep dive
                </TabsTrigger>
              </TabsList>
              <TabsContent value="analogy">
                The event loop is a cook with one stove and many timers.
              </TabsContent>
              <TabsContent value="code">
                <code className={s.code}>setTimeout(() =&gt; serve(), 0)</code>
              </TabsContent>
              <TabsContent value="diagram">
                Call stack, task queue, microtask queue.
              </TabsContent>
              <TabsContent value="interview">
                Why does a resolved promise run before a timer?
              </TabsContent>
            </Tabs>
            <Tabs variant="pill" defaultValue="orders" activationMode="manual">
              <TabsList aria-label="Account sections">
                <TabsTrigger value="orders">Orders</TabsTrigger>
                <TabsTrigger value="grants">Access</TabsTrigger>
                <TabsTrigger value="events">History</TabsTrigger>
              </TabsList>
              <p className="text-sm text-muted-foreground">
                Arrow keys move, Enter opens.
              </p>
              <TabsContent value="orders">
                Three orders, one refunded.
              </TabsContent>
              <TabsContent value="grants">
                Battleship Pro until May.
              </TabsContent>
              <TabsContent value="events">
                Signed in from a new phone.
              </TabsContent>
            </Tabs>
          </div>
        </section>

        <section id="toggles" aria-labelledby="toggles-title">
          <Head
            kicker="toggles"
            id="toggles-title"
            level={3}
            title="Chips and segments"
          />
          <div className={`${s.clip} ${s.grid2}`}>
            <div className="grid justify-items-start gap-3">
              <p id="spec-modes" className={s.caption}>
                One choice · chip
              </p>
              <ToggleGroup
                type="single"
                defaultValue="all"
                aria-labelledby="spec-modes"
              >
                <ToggleGroupItem value="all">All cards</ToggleGroupItem>
                <ToggleGroupItem value="new">New</ToggleGroupItem>
                <ToggleGroupItem value="again">Again</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="grid justify-items-start gap-3">
              <p id="spec-topics" className={s.caption}>
                Several · small chip
              </p>
              <ToggleGroup
                type="multiple"
                size="sm"
                defaultValue={["async", "network"]}
                aria-labelledby="spec-topics"
              >
                <ToggleGroupItem value="async">Async</ToggleGroupItem>
                <ToggleGroupItem value="memory">Memory</ToggleGroupItem>
                <ToggleGroupItem value="network">Network</ToggleGroupItem>
                <ToggleGroupItem value="sql">SQL</ToggleGroupItem>
                <ToggleGroupItem value="archive" disabled>
                  Archive
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="grid justify-items-start gap-3">
              <p id="spec-speed" className={s.caption}>
                Segmented · small
              </p>
              <ToggleGroup
                type="single"
                variant="segmented"
                size="sm"
                defaultValue="1"
                aria-labelledby="spec-speed"
              >
                <ToggleGroupItem value="0.5">0.5×</ToggleGroupItem>
                <ToggleGroupItem value="1">1×</ToggleGroupItem>
                <ToggleGroupItem value="2">2×</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="grid justify-items-start gap-3">
              <p id="spec-view" className={s.caption}>
                Segmented · medium
              </p>
              <ToggleGroup
                type="single"
                variant="segmented"
                defaultValue="list"
                aria-labelledby="spec-view"
              >
                <ToggleGroupItem value="list">List</ToggleGroupItem>
                <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
                <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </section>

        <section id="progress" aria-labelledby="progress-title">
          <Head
            kicker="progress"
            id="progress-title"
            level={3}
            title="Three sizes, two tones"
          />
          <div className={`${s.clip} ${s.stack}`}>
            <div className="grid gap-2">
              <div className="flex justify-between gap-4 text-sm">
                <span id="spec-exercises" className="font-medium">
                  Exercises
                </span>
                <span className="text-muted-foreground tabular-nums">
                  3 of 10
                </span>
              </div>
              <Progress
                aria-labelledby="spec-exercises"
                value={3}
                max={10}
                size="sm"
                valueText="3 of 10"
              />
            </div>
            <Progress label="Upload" value={62} valueText="62%" />
            <Progress
              label="Course finished"
              value={130}
              max={100}
              size="lg"
              tone="ok"
            />
            <ProgressDemo />
          </div>
        </section>

        <section id="account" aria-labelledby="account-title">
          <Head
            kicker="account"
            id="account-title"
            level={3}
            title="The platform menu"
          />
          <div className={s.grid2}>
            {(
              [
                ["Signed in", <AccountMenuDemo key="in" signedIn />],
                [
                  "Signed in, compact",
                  <AccountMenuDemo key="compact" signedIn compact />,
                ],
                ["Signed out", <AccountMenuDemo key="out" signedIn={false} />],
                [
                  "Still asking Identity",
                  <AccountMenuPlaceholder key="wait" />,
                ],
              ] as const
            ).map(([caption, menu]) => (
              <div key={caption} className={s.clip}>
                <p className={s.caption}>{caption}</p>
                <div className={s.appBar}>
                  <span className={s.appName}>Battleship</span>
                  {menu}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="loading" aria-labelledby="loading-title">
          <Head
            kicker="feedback"
            id="loading-title"
            level={3}
            title="Copy and loading"
          />
          <div className={s.grid2}>
            <div className={s.clip}>
              <p className={s.caption}>Copy: ghost, outline, icon, refused</p>
              <code className={s.code}>pnpm --filter @outegro/ui test</code>
              <div className={s.row}>
                <CopyButton
                  value="pnpm --filter @outegro/ui test"
                  label="Copy"
                  copiedLabel="Copied"
                  failedLabel="Couldn't copy"
                />
                <CopyButton
                  variant="outline"
                  size="md"
                  value="https://outegro.dev/design-system"
                  label="Copy link"
                  copiedLabel="Copied"
                  failedLabel="Couldn't copy"
                />
                <CopyButton
                  variant="outline"
                  size="icon-sm"
                  value="https://outegro.dev/design-system"
                  label="Copy link"
                  copiedLabel="Copied"
                  failedLabel="Couldn't copy"
                />
                <RefusedCopy />
              </div>
            </div>
            <div className={s.clip}>
              <p className={s.caption}>Skeleton and spinner</p>
              <div className={s.skeletonCard}>
                <Skeleton className="size-11" />
                <div className="grid gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-24 w-full" />
              <p className="flex items-center gap-2 text-sm" role="status">
                <Spinner /> Loading the board…
              </p>
            </div>
          </div>
        </section>

        <section id="surfaces" aria-labelledby="surfaces-title">
          <Head
            kicker="surfaces"
            id="surfaces-title"
            level={3}
            title="Cards and the night tone"
          />
          <div className={s.stack}>
            <div className={s.grid2}>
              <Surface className="p-6">
                Solid: a card pasted on the page.
              </Surface>
              <Surface variant="glass" className="p-6">
                Glass: small chrome, navigation and chips.
              </Surface>
              <Surface variant="muted" className="p-6">
                Muted: a quiet panel behind a group.
              </Surface>
              <Surface variant="inverse" className="p-6">
                Inverse: a page printed in reverse.
              </Surface>
            </div>
            <div data-tone="dark" className={s.night}>
              <p className="og-eyebrow">data-tone="dark"</p>
              <div className={s.row}>
                <Button>Fire</Button>
                <Button variant="outline">Pass</Button>
                <Button variant="glass">Filters</Button>
                <Button variant="ghost">Rules</Button>
              </div>
              <ul className={s.row}>
                <li>
                  <Badge>Ranked</Badge>
                </li>
                <li>
                  <Badge variant="solid">Pro</Badge>
                </li>
                <li>
                  <Badge variant="muted">Bot</Badge>
                </li>
              </ul>
              <ToggleGroup
                type="single"
                defaultValue="night"
                aria-label="Board"
              >
                <ToggleGroupItem value="day">Day sea</ToggleGroupItem>
                <ToggleGroupItem value="night">Night sea</ToggleGroupItem>
              </ToggleGroup>
              <Progress
                label="Fleet afloat"
                value={7}
                max={10}
                valueText="7 of 10"
              />
              <div className={s.field}>
                <Label htmlFor="night-code">Invite code</Label>
                <Input
                  id="night-code"
                  name="night-code"
                  defaultValue="SEA-7"
                  autoComplete="off"
                  aria-invalid
                  aria-describedby="night-code-error"
                />
                <FormMessage id="night-code-error" tone="error">
                  This code has expired.
                </FormMessage>
              </div>
              <Notice tone="danger" title="Connection lost">
                We are trying again.
              </Notice>
            </div>
          </div>
        </section>

        <section id="misc" aria-labelledby="misc-title">
          <Head
            kicker="the rest"
            id="misc-title"
            level={3}
            title="Language and accordion"
          />
          <div className={s.grid2}>
            <div className={s.clip}>
              <p className={s.caption}>Language switch</p>
              <LanguageSwitchDemo />
            </div>
            <div className={s.clip}>
              <Accordion type="single" collapsible defaultValue="pay">
                <AccordionItem value="pay">
                  <AccordionTrigger>How do I pay?</AccordionTrigger>
                  <AccordionContent>
                    By card on pay.outegro.dev; the receipt comes by email.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="refund">
                  <AccordionTrigger>Can I get a refund?</AccordionTrigger>
                  <AccordionContent>
                    Within 14 days, no questions asked.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </section>
      </LevelSwitch>
    </section>
  );
}
