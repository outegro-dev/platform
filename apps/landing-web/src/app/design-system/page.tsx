import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { CopyButton } from "@outegro/ui/copy-button";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { Notice, StatePanel } from "@outegro/ui/notice";
import { Progress } from "@outegro/ui/progress";
import { Surface } from "@outegro/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@outegro/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@outegro/ui/toggle-group";
import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  CloudSlashIcon,
  GearSixIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContactDialog } from "@/components/contact-dialog";
import { ContactLinks } from "@/components/contact-links";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { PendingButton, ProgressDemo, RefusedCopy } from "./demos";

export const metadata: Metadata = {
  title: "Material library — Nick Lukashik",
  robots: { index: false, follow: false },
};

// Outlines the invisible ::after that takes compact controls to 44 px.
const showTargets =
  "[&_[data-slot=button]]:after:outline-1 [&_[data-slot=button]]:after:outline-dashed [&_[data-slot=button]]:after:outline-ring/60 [&_[data-slot=toggle-group-item]]:after:outline-1 [&_[data-slot=toggle-group-item]]:after:outline-dashed [&_[data-slot=toggle-group-item]]:after:outline-ring/60";

const softTokens = [
  { name: "--ok-soft", fill: "bg-ok-soft text-ok", text: "tokenOk" },
  { name: "--warn-soft", fill: "bg-warn-soft text-warn", text: "tokenWarn" },
  {
    name: "--danger-soft",
    fill: "bg-danger-soft text-danger",
    text: "tokenDanger",
  },
  { name: "--info-soft", fill: "bg-info-soft text-info", text: "tokenInfo" },
] as const;

export default async function Gallery() {
  const t = await getTranslations("gallery");
  const copyLabels = {
    label: t("copyLabel"),
    copiedLabel: t("copied"),
    failedLabel: t("copyFailed"),
  };
  return (
    <main className="gallery og-container">
      <div className="gallery-top">
        <a href="/" className="gallery-back">
          {t("back")} <ArrowUpRightIcon />
        </a>
        <LocaleSwitcher />
      </div>
      <h1>
        {t("title").split(" ").slice(0, -1).join(" ")}{" "}
        <span className="og-accent">{t("title").split(" ").at(-1)}</span>
      </h1>
      <p>{t("intro")}</p>

      <section>
        <h2 className="og-eyebrow">{t("type")}</h2>
        <p className="gallery-display">
          Aa <span className="og-accent">Aa</span>
        </p>
        <p className="og-eyebrow">
          Manrope · Cormorant Garamond Italic · JetBrains Mono
        </p>
      </section>

      <section>
        <h2 className="og-eyebrow">{t("buttons")}</h2>
        <div className="gallery-row">
          <Button asChild size="lg">
            <a href="#surfaces">{t("primary")}</a>
          </Button>
          <Button variant="secondary" size="lg">
            {t("secondary")}
          </Button>
          <Button variant="outline" size="lg">
            {t("outline")}
          </Button>
          <Button variant="glass" size="lg">
            {t("glassAction")}
          </Button>
          <Button size="lg" disabled>
            {t("disabled")}
          </Button>
          <ContactDialog variant="primary" compact>
            <ContactLinks compact />
          </ContactDialog>
        </div>
      </section>

      <section id="targets">
        <h2 className="og-eyebrow">{t("targets")}</h2>
        <p className="mb-5 max-w-[62ch] text-muted-foreground">
          {t("targetsNote")}
        </p>
        <div className={`gallery-row ${showTargets}`}>
          <Button size="sm">{t("small")}</Button>
          <PendingButton label={t("small")} pendingLabel={t("saving")} />
          <Button size="icon-sm" variant="outline" aria-label={t("settings")}>
            <GearSixIcon />
          </Button>
          <ToggleGroup
            type="single"
            variant="segmented"
            size="sm"
            defaultValue="1"
            aria-label={t("speed")}
          >
            <ToggleGroupItem value="0.5">0.5×</ToggleGroupItem>
            <ToggleGroupItem value="1">1×</ToggleGroupItem>
            <ToggleGroupItem value="2">2×</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="multiple"
            size="sm"
            defaultValue={["async"]}
            aria-label={t("topics")}
          >
            <ToggleGroupItem value="async">{t("topicAsync")}</ToggleGroupItem>
            <ToggleGroupItem value="memory">{t("topicMemory")}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </section>

      <section>
        <h2 className="og-eyebrow">{t("badges")}</h2>
        <div className="gallery-row">
          <Badge>TypeScript</Badge>
          <Badge variant="solid">NestJS 12</Badge>
          <Badge variant="muted">K3s</Badge>
          <Badge variant="glass">Beta</Badge>
        </div>
      </section>

      <section id="surfaces">
        <h2 className="og-eyebrow">{t("surfaces")}</h2>
        <div className="gallery-surfaces">
          <Surface variant="glass">{t("glass")}</Surface>
          <Surface>{t("solid")}</Surface>
          <Surface variant="inverse">{t("inverse")}</Surface>
        </div>
      </section>

      <section id="tokens">
        <h2 className="og-eyebrow">{t("tokens")}</h2>
        <p className="mb-5 max-w-[62ch] text-muted-foreground">
          {t("tokensNote")}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {(["light", "dark"] as const).map((tone) => (
            <div
              key={tone}
              data-tone={tone === "dark" ? "dark" : undefined}
              className="grid min-w-0 content-start gap-4 rounded-lg border border-border bg-background p-4 text-foreground sm:p-6"
            >
              <p className="og-eyebrow">
                {t(tone === "dark" ? "darkTone" : "lightTone")}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {softTokens.map((token) => (
                  <li
                    key={token.name}
                    className={`grid gap-0.5 rounded-md px-3 py-2.5 ${token.fill}`}
                  >
                    <code className="font-mono text-[12px]">{token.name}</code>
                    <span className="text-sm font-semibold">
                      {t(token.text)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg border border-border bg-surface p-5 text-sm shadow-soft">
                <code className="font-mono text-[12px] text-muted-foreground">
                  --shadow-soft
                </code>
                <p>{t("shadowSoft")}</p>
              </div>
              <Notice tone="danger" title={t("noticeDangerTitle")}>
                {t("noticeDanger")}
              </Notice>
              <Progress
                label={t("cards")}
                value={7}
                max={12}
                tone="ok"
                valueText={t("exercisesValue", { solved: 7, total: 12 })}
              />
            </div>
          ))}
        </div>
      </section>

      <section id="tabs">
        <h2 className="og-eyebrow">{t("tabs")}</h2>
        <div className="grid max-w-3xl gap-10">
          <Tabs defaultValue="analogy">
            <TabsList aria-label={t("tabsLabel")}>
              <TabsTrigger value="analogy">{t("tabAnalogy")}</TabsTrigger>
              <TabsTrigger value="code">{t("tabCode")}</TabsTrigger>
              <TabsTrigger value="diagram">{t("tabDiagram")}</TabsTrigger>
              <TabsTrigger value="interview">{t("tabInterview")}</TabsTrigger>
              <TabsTrigger value="deep" disabled>
                {t("tabDeep")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="analogy">{t("tabAnalogyBody")}</TabsContent>
            <TabsContent value="code">
              <code className="font-mono text-sm">{t("tabCodeBody")}</code>
            </TabsContent>
            <TabsContent value="diagram">{t("tabDiagramBody")}</TabsContent>
            <TabsContent value="interview">{t("tabInterviewBody")}</TabsContent>
          </Tabs>
          <Tabs variant="pill" defaultValue="orders" activationMode="manual">
            <TabsList aria-label={t("sectionsLabel")}>
              <TabsTrigger value="orders">{t("tabOrders")}</TabsTrigger>
              <TabsTrigger value="grants">{t("tabGrants")}</TabsTrigger>
              <TabsTrigger value="events">{t("tabEvents")}</TabsTrigger>
            </TabsList>
            <p className="text-sm text-muted-foreground">{t("manualHint")}</p>
            <TabsContent value="orders">{t("tabOrdersBody")}</TabsContent>
            <TabsContent value="grants">{t("tabGrantsBody")}</TabsContent>
            <TabsContent value="events">{t("tabEventsBody")}</TabsContent>
          </Tabs>
        </div>
      </section>

      <section id="toggles">
        <h2 className="og-eyebrow">{t("toggles")}</h2>
        <div className="grid gap-7">
          <div className="grid gap-3">
            <p id="toggle-modes" className="text-sm font-medium">
              {t("deckModes")}
            </p>
            <ToggleGroup
              type="single"
              defaultValue="all"
              aria-labelledby="toggle-modes"
            >
              <ToggleGroupItem value="all">{t("modeAll")}</ToggleGroupItem>
              <ToggleGroupItem value="new">{t("modeNew")}</ToggleGroupItem>
              <ToggleGroupItem value="again">{t("modeAgain")}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid gap-3">
            <p id="toggle-topics" className="text-sm font-medium">
              {t("topics")}
            </p>
            <ToggleGroup
              type="multiple"
              size="sm"
              defaultValue={["async", "network"]}
              aria-labelledby="toggle-topics"
            >
              <ToggleGroupItem value="async">{t("topicAsync")}</ToggleGroupItem>
              <ToggleGroupItem value="memory">
                {t("topicMemory")}
              </ToggleGroupItem>
              <ToggleGroupItem value="network">
                {t("topicNetwork")}
              </ToggleGroupItem>
              <ToggleGroupItem value="sql">SQL</ToggleGroupItem>
              <ToggleGroupItem value="archive" disabled>
                {t("topicArchive")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-7">
            <div className="grid gap-3">
              <p id="toggle-speed" className="text-sm font-medium">
                {t("speed")}
              </p>
              <ToggleGroup
                type="single"
                variant="segmented"
                size="sm"
                defaultValue="1"
                aria-labelledby="toggle-speed"
              >
                <ToggleGroupItem value="0.5">0.5×</ToggleGroupItem>
                <ToggleGroupItem value="1">1×</ToggleGroupItem>
                <ToggleGroupItem value="2">2×</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="grid gap-3">
              <p id="toggle-view" className="text-sm font-medium">
                {t("view")}
              </p>
              <ToggleGroup
                type="single"
                variant="segmented"
                defaultValue="list"
                aria-labelledby="toggle-view"
              >
                <ToggleGroupItem value="list">{t("viewList")}</ToggleGroupItem>
                <ToggleGroupItem value="grid">{t("viewGrid")}</ToggleGroupItem>
                <ToggleGroupItem value="compact">
                  {t("viewCompact")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>
      </section>

      <section id="progress">
        <h2 className="og-eyebrow">{t("progress")}</h2>
        <div className="grid max-w-xl gap-7">
          <div className="grid gap-2">
            <div className="flex justify-between gap-4 text-sm">
              <span id="progress-exercises" className="font-medium">
                {t("exercises")}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {t("exercisesValue", { solved: 3, total: 10 })}
              </span>
            </div>
            <Progress
              aria-labelledby="progress-exercises"
              value={3}
              max={10}
              size="sm"
              valueText={t("exercisesValue", { solved: 3, total: 10 })}
            />
          </div>
          <div className="grid gap-2">
            <span id="progress-upload" className="text-sm font-medium">
              {t("clamped")}
            </span>
            <Progress
              aria-labelledby="progress-upload"
              value={130}
              max={100}
              size="lg"
              tone="ok"
            />
          </div>
          <ProgressDemo
            label={t("chapterRead")}
            options={[0, 40, 75, 100].map((value) => ({
              value,
              text: t("percent", { value }),
            }))}
          />
        </div>
      </section>

      <section id="copy">
        <h2 className="og-eyebrow">{t("copy")}</h2>
        <div className="grid gap-5">
          <div className="gallery-row">
            <code className="min-w-0 rounded-md bg-secondary px-3 py-2.5 font-mono text-sm break-all">
              pnpm --filter @outegro/ui test
            </code>
            <CopyButton
              value="pnpm --filter @outegro/ui test"
              {...copyLabels}
            />
            <CopyButton
              variant="outline"
              size="md"
              value="https://outegro.dev/design-system"
              {...copyLabels}
              label={t("copyLink")}
            />
            <CopyButton
              variant="outline"
              size="icon-sm"
              value="https://outegro.dev/design-system"
              {...copyLabels}
              label={t("copyLink")}
            />
          </div>
          <div className="gallery-row">
            <p className="max-w-[52ch] text-sm text-muted-foreground">
              {t("copyRefused")}
            </p>
            <RefusedCopy {...copyLabels} />
          </div>
        </div>
      </section>

      <section id="notices">
        <h2 className="og-eyebrow">{t("notices")}</h2>
        <div className="grid max-w-3xl gap-3">
          <Notice>{t("noticeNeutral")}</Notice>
          <Notice tone="info" title={t("noticeInfoTitle")}>
            {t("noticeInfo")}
          </Notice>
          <Notice tone="success">{t("noticeSuccess")}</Notice>
          <Notice tone="warning" title={t("noticeWarningTitle")}>
            {t("noticeWarning")}
          </Notice>
          <Notice
            tone="danger"
            title={t("noticeDangerTitle")}
            actions={
              <>
                <Button size="sm">
                  <ArrowClockwiseIcon />
                  {t("retry")}
                </Button>
                <Button size="sm" variant="ghost">
                  {t("details")}
                </Button>
              </>
            }
          >
            {t("noticeDanger")}
          </Notice>
        </div>
      </section>

      <section id="states">
        <h2 className="og-eyebrow">{t("statePanels")}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Surface>
            <StatePanel
              as="div"
              size="sm"
              headingLevel={3}
              title={t("emptyTitle")}
              description={t("emptyBody")}
              actions={
                <Button size="sm" variant="outline">
                  {t("emptyAction")}
                </Button>
              }
            />
          </Surface>
          <Surface>
            <StatePanel
              as="div"
              size="sm"
              headingLevel={3}
              tone="warning"
              icon={<CloudSlashIcon />}
              title={t("offlineTitle")}
              description={t("offlineBody")}
            />
          </Surface>
          <Surface className="md:col-span-2">
            <StatePanel
              as="div"
              headingLevel={3}
              tone="danger"
              title={t("errorTitle")}
              description={t("errorBody")}
              actions={
                <Button size="lg" variant="outline">
                  <ArrowClockwiseIcon />
                  {t("retry")}
                </Button>
              }
            />
          </Surface>
        </div>
      </section>

      <section id="field">
        <Label htmlFor="demo-email">{t("input")}</Label>
        <Input
          id="demo-email"
          name="demo-email"
          type="email"
          spellCheck={false}
          autoComplete="email"
          aria-describedby="email-help"
        />
        <p id="email-help">{t("inputHelp")}</p>
      </section>

      <section>
        <h2 className="og-eyebrow">{t("states")}</h2>
        <p className="text-destructive">{t("error")}</p>
        <p className="text-success">{t("success")}</p>
      </section>
    </main>
  );
}
