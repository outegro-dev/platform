"use client";

import type { ExplainKind } from "@outegro/contracts/edu";
import { Surface } from "@outegro/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@outegro/ui/tabs";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useReaderStores } from "@/stores/provider";

/**
 * "See it from different angles": one topic explained several ways, as
 * kit tabs (arrow keys move between them). The tab shown is this block's
 * own; the reader's choice becomes their preferred view
 * (ExplainPreferenceStore: saved to the account, or kept in this browser)
 * and the next blocks open with it. Every view stays mounted, so a sandbox
 * inside one keeps its query and result.
 */
export const ExplainTabs = observer(function ExplainTabs({
  topic,
  views,
}: {
  topic: string;
  views: { kind: ExplainKind; content: ReactNode }[];
}) {
  "use no memo";
  const { explain } = useReaderStores();
  const t = useTranslations("book.explain");
  const kinds = views.map((view) => view.kind);
  const preferred = explain.view;
  const [value, setValue] = useState<ExplainKind>(() =>
    preferred && kinds.includes(preferred)
      ? preferred
      : (kinds[0] ?? "analogy"),
  );
  const touched = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const available = kinds.join();

  // A preference that arrives later (kept in this browser) or changes in
  // another block applies only where the reader has not chosen and cannot
  // see: nothing on screen changes height under their eyes.
  useEffect(() => {
    if (!preferred || touched.current) return;
    if (!available.split(",").includes(preferred)) return;
    const node = root.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    if (box.top > window.innerHeight || box.bottom < 0) setValue(preferred);
  }, [preferred, available]);

  const change = (next: string) => {
    const kind = next as ExplainKind;
    touched.current = true;
    setValue(kind);
    explain.choose(kind);
  };

  return (
    <Surface className="explain" ref={root}>
      <div className="explain-head">
        <p className="explain-kicker">{t("kicker")}</p>
        <p className="explain-topic">{topic}</p>
      </div>
      <Tabs value={value} onValueChange={change} className="gap-0">
        <TabsList className="px-3.5 pt-2" aria-label={`${t("tabs")}: ${topic}`}>
          {views.map((view) => (
            <TabsTrigger
              key={view.kind}
              value={view.kind}
              className="data-[state=active]:border-(--bk)"
            >
              {t(`kinds.${view.kind}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {views.map((view) => (
          <TabsContent
            key={view.kind}
            value={view.kind}
            className="explain-body"
            forceMount
          >
            {view.content}
          </TabsContent>
        ))}
      </Tabs>
      <p className="explain-hint">{t("hint")}</p>
    </Surface>
  );
});
