"use client";

import { Button } from "@outegro/ui/button";
import { Surface } from "@outegro/ui/surface";
import { ToggleGroup, ToggleGroupItem } from "@outegro/ui/toggle-group";
import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { InlineText } from "@/components/book/inline";
import {
  type SimulatorScenario,
  SimulatorStore,
} from "@/stores/simulator-store";
import { ScrollRegion } from "./scroll-region";

/**
 * The book's event loop simulator: pick a scenario, then step through it.
 * Each step shows the line being run, where the loop is (the phase strip),
 * what waits in each queue, what the console printed (new lines stand
 * out) and a note on why. Every box keeps its size between steps.
 */
export const EventLoopSimulator = observer(function EventLoopSimulator({
  scenarios,
}: {
  scenarios: SimulatorScenario[];
}) {
  "use no memo";
  const [store] = useState(() => new SimulatorStore(scenarios));
  const t = useTranslations("book.simulator");
  const { scenario, state, atStart, atEnd } = store;
  if (!scenario || !state) return null;

  return (
    <Surface asChild className="simulator">
      <section aria-label={t("title")}>
        <div className="sim-top">
          <p className="sim-title">{t("title")}</p>
          <ToggleGroup
            type="single"
            variant="chip"
            size="sm"
            className="sim-scenarios"
            aria-label={t("scenario")}
            value={String(store.scenarioIndex)}
            onValueChange={(value) => store.pick(Number(value))}
          >
            {store.scenarios.map((item, index) => (
              <ToggleGroupItem key={item.name} value={String(index)}>
                {item.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="sim-body">
          <ScrollRegion className="sim-code-scroll" label={t("code")}>
            <ol className="sim-code" aria-label={t("code")}>
              {scenario.lines.map((line, index) => {
                const current = state.l === index + 1;
                return (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: code lines are fixed per scenario
                    key={index}
                    data-current={current || undefined}
                    aria-current={current ? "step" : undefined}
                  >
                    <span className="sim-ln" aria-hidden="true">
                      {index + 1}
                    </span>
                    {/* biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js output of the book's scenario code */}
                    <code dangerouslySetInnerHTML={{ __html: line || " " }} />
                  </li>
                );
              })}
            </ol>
          </ScrollRegion>
          <div className="sim-state">
            <ol className="sim-phases" aria-label={t("where")}>
              {store.strip.map(({ item, isBreak, on }) =>
                isBreak ? (
                  <li key={item} className="sim-sep" aria-hidden="true" />
                ) : (
                  <li
                    key={item}
                    data-on={on || undefined}
                    aria-current={on ? "step" : undefined}
                  >
                    {t(`phases.${item}`)}
                  </li>
                ),
              )}
            </ol>
            <div className="sim-queues">
              {store.queues.map((queue) => (
                <div
                  key={queue}
                  className="sim-queue"
                  data-kind={queue}
                  data-hot={store.isHot(queue) || undefined}
                >
                  <p className="sim-queue-title">{t(`queues.${queue}`)}</p>
                  <ul>
                    {state[queue].map((item, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: queue entries may repeat
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="sim-output">
              <p className="sim-queue-title">{t("console")}</p>
              <div className="sim-console">
                {state.out.length ? (
                  state.out.map((line, index) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: output lines are positional
                      key={index}
                      data-new={store.fresh[index] || undefined}
                    >
                      {line}
                    </span>
                  ))
                ) : (
                  <span className="sim-console-empty">{t("consoleEmpty")}</span>
                )}
              </div>
            </div>
          </div>
        </div>
        <p className="sim-note" aria-live="polite">
          <InlineText nodes={state.note} />
        </p>
        <div className="sim-controls">
          <p className="sim-step">
            {t("step", { index: store.step + 1, total: store.total })}
          </p>
          <div className="sim-buttons">
            <Button
              size="sm"
              variant="ghost"
              aria-disabled={atStart || undefined}
              onClick={store.first}
            >
              <ArrowCounterClockwiseIcon aria-hidden="true" />
              {t("start")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-disabled={atStart || undefined}
              onClick={store.back}
            >
              <ArrowLeftIcon aria-hidden="true" />
              {t("back")}
            </Button>
            <Button
              size="sm"
              aria-disabled={atEnd || undefined}
              onClick={store.next}
            >
              {t("next")}
              <ArrowRightIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>
    </Surface>
  );
});
