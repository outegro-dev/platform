"use client";

import {
  type ApplicationCard,
  type ApplicationStage,
  type ArchiveReason,
  applicationFlagSchema,
  type Board,
} from "@outegro/contracts/atelier";
import { Button } from "@outegro/ui/button";
import {
  ArchiveIcon,
  CaretDownIcon,
  CaretUpIcon,
  FunnelXIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import {
  useActionStatus,
  useFailureText,
} from "@/components/chrome/action-status";
import {
  applyMove,
  type BoardFilters,
  columnsOf,
  emptyFilters,
  filtersQuery,
  isFiltered,
  type Move,
  matches,
  sourcesOf,
} from "@/lib/board";
import { writeApi } from "@/lib/client-api";
import { BoardCard, CARD_MIME } from "./board-card";
import { ArchiveDialog } from "./move-menu";
import { useSourceLabel } from "./parts";

/**
 * The board: filters, a stage switcher on phones and tablets, and the
 * columns. Moves show at once (an optimistic copy of the board) and are
 * confirmed by the server's next render; a refused move puts the card back
 * and says so. Filters live in the address bar, so a reload keeps them.
 */
export function BoardView({
  board,
  now,
  initialFilters,
}: {
  board: Board;
  now: number;
  initialFilters: BoardFilters;
}) {
  const t = useTranslations("board");
  const stageName = useTranslations("stages");
  const reasonName = useTranslations("reasons");
  const flagName = useTranslations("flags");
  const sourceLabel = useSourceLabel();
  const router = useRouter();
  const show = useActionStatus();
  const failureText = useFailureText();
  const ids = useId();

  // Moves not yet in the server's board; dropped when a new board arrives.
  const [moves, setMoves] = useState<Move[]>([]);
  const [seen, setSeen] = useState(board);
  if (seen !== board) {
    setSeen(board);
    setMoves([]);
  }
  const shown = moves.reduce(applyMove, board);

  const [filters, setFilters] = useState(initialFilters);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [asking, setAsking] = useState<ApplicationCard | null>(null);
  const [dragging, setDragging] = useState<ApplicationCard | null>(null);
  const [over, setOver] = useState<ApplicationStage | null>(null);
  const [canDrag, setCanDrag] = useState(false);
  const [active, setActive] = useState<ApplicationStage>("found");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine) and (min-width: 1024px)");
    const update = () => setCanDrag(fine.matches);
    update();
    fine.addEventListener("change", update);
    return () => fine.removeEventListener("change", update);
  }, []);

  const changeFilters = (next: BoardFilters) => {
    setFilters(next);
    const url = `${window.location.pathname}${filtersQuery(next)}`;
    window.history.replaceState(window.history.state, "", url);
  };

  const move = (
    card: ApplicationCard,
    stage: ApplicationStage,
    reason?: ArchiveReason,
  ) => {
    if (card.stage === stage && stage !== "archived") return;
    const entry: Move = { id: card.id, stage, archiveReason: reason };
    setMoves((current) => [...current, entry]);
    void writeApi("POST", `/applications/${card.id}/stage`, {
      stage,
      ...(reason ? { archiveReason: reason } : {}),
    }).then((result) => {
      if (result.ok) {
        show(
          stage === "archived" && reason
            ? t("archived", {
                company: card.company,
                reason: reasonName(reason),
              })
            : t("moved", { company: card.company, stage: stageName(stage) }),
          "success",
        );
        router.refresh();
        return;
      }
      setMoves((current) => current.filter((m) => m !== entry));
      if (result.failure === "conflict" || result.failure === "not-found")
        router.refresh();
      show(
        result.failure === "offline" || result.failure === "signed-out"
          ? failureText(result.failure)
          : t("moveFailed", {
              company: card.company,
              stage: stageName(card.stage),
            }),
        result.failure === "offline" ? "offline" : "error",
      );
    });
  };

  // The archive asks why; the menu closes first, so the dialog opens after it.
  const askArchive = (card: ApplicationCard) =>
    window.setTimeout(() => setAsking(card), 0);

  const columns = columnsOf(shown).map((column) => ({
    ...column,
    visible: column.items.filter((card) => matches(card, filters)),
  }));
  const total = columns.reduce((sum, c) => sum + c.items.length, 0);
  const visibleTotal = columns.reduce((sum, c) => sum + c.visible.length, 0);
  const filtered = isFiltered(filters);
  const sources = sourcesOf(shown);

  // Which column is in view (phones and tablets, for the stage switcher).
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    let frame = 0;
    const phone = window.matchMedia("(max-width: 767px)");
    const measure = () => {
      frame = 0;
      // A phone shows one column at a time: the switcher decides.
      if (phone.matches) return;
      const columnsInView = [
        ...node.querySelectorAll<HTMLElement>("[data-column]"),
      ];
      const left = node.scrollLeft + 24;
      let current = columnsInView[0]?.dataset.column;
      for (const column of columnsInView)
        if (
          column.offsetParent !== null &&
          column.offsetLeft - node.offsetLeft <= left
        )
          current = column.dataset.column;
      if (current) setActive(current as ApplicationStage);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      node.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const goTo = (stage: ApplicationStage) => {
    const node = scroller.current;
    const column = node?.querySelector<HTMLElement>(`[data-column="${stage}"]`);
    if (!node || !column) return;
    if (stage === "archived") setArchiveOpen(true);
    setActive(stage);
    if (window.matchMedia("(max-width: 767px)").matches) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({
      left: column.offsetLeft - node.offsetLeft - 16,
      behavior: still ? "auto" : "smooth",
    });
  };

  const drop = (stage: ApplicationStage, id: string) => {
    const card = columns.flatMap((c) => c.items).find((c) => c.id === id);
    setDragging(null);
    setOver(null);
    if (!card || card.stage === stage) return;
    if (stage === "archived") setAsking(card);
    else move(card, stage);
  };

  return (
    <>
      <search className="board-filters" aria-label={t("filters.label")}>
        <div className="field field-search">
          <label className="sr-only" htmlFor={`${ids}-q`}>
            {t("filters.search")}
          </label>
          <MagnifyingGlassIcon aria-hidden="true" className="field-icon" />
          <input
            id={`${ids}-q`}
            className="text-input"
            type="search"
            value={filters.q}
            placeholder={t("filters.searchPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) =>
              changeFilters({ ...filters, q: event.target.value })
            }
          />
        </div>
        <div className="field">
          <label className="sr-only" htmlFor={`${ids}-source`}>
            {t("filters.source")}
          </label>
          <select
            id={`${ids}-source`}
            className="select"
            value={filters.source}
            onChange={(event) =>
              changeFilters({ ...filters, source: event.target.value })
            }
          >
            <option value="">{t("filters.anySource")}</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {sourceLabel(source)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="sr-only" htmlFor={`${ids}-flag`}>
            {t("filters.flag")}
          </label>
          <select
            id={`${ids}-flag`}
            className="select"
            value={filters.flag}
            onChange={(event) => {
              const flag = applicationFlagSchema.safeParse(event.target.value);
              changeFilters({
                ...filters,
                flag: flag.success ? flag.data : "",
              });
            }}
          >
            <option value="">{t("filters.anyFlag")}</option>
            {applicationFlagSchema.options.map((flag) => (
              <option key={flag} value={flag}>
                {flagName(flag)}
              </option>
            ))}
          </select>
        </div>
        <p className="board-count" aria-live="polite">
          {filtered
            ? t("filters.showing", { shown: visibleTotal, total })
            : null}
        </p>
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            className="board-clear"
            onClick={() => changeFilters(emptyFilters)}
          >
            <FunnelXIcon aria-hidden="true" />
            {t("filters.clear")}
          </Button>
        ) : null}
      </search>

      <nav className="stage-switcher" aria-label={t("switcher")}>
        <ul>
          {columns.map((column) => (
            <li key={column.stage}>
              <button
                type="button"
                className="stage-pill"
                aria-current={active === column.stage ? "true" : undefined}
                onClick={() => goTo(column.stage)}
              >
                {stageName(column.stage)}
                <span className="stage-pill-count">
                  {filtered ? column.visible.length : column.items.length}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {filtered && visibleTotal === 0 ? (
        <div className="board-nothing" role="status">
          <p className="board-nothing-title">{t("filters.nothing")}</p>
          <p>{t("filters.nothingHint")}</p>
        </div>
      ) : null}

      <section
        className="board-scroller"
        ref={scroller}
        aria-label={t("columns")}
        data-dragging={dragging ? "" : undefined}
      >
        <div className="board-columns">
          {columns.map((column) => {
            const archive = column.stage === "archived";
            const collapsed = archive && !archiveOpen;
            const count = filtered
              ? column.visible.length
              : column.items.length;
            const titleId = `${ids}-col-${column.stage}`;
            return (
              <section
                key={column.stage}
                className="column"
                data-column={column.stage}
                data-collapsed={collapsed || undefined}
                data-active={active === column.stage || undefined}
                data-over={over === column.stage || undefined}
                aria-labelledby={titleId}
                onDragOver={(event) => {
                  if (!dragging || dragging.stage === column.stage) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (over !== column.stage) setOver(column.stage);
                }}
                onDragLeave={(event) => {
                  const next = event.relatedTarget as Node | null;
                  if (!next || !event.currentTarget.contains(next))
                    setOver((current) =>
                      current === column.stage ? null : current,
                    );
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData(CARD_MIME);
                  if (id) drop(column.stage, id);
                }}
              >
                <header className="column-head">
                  <h2 className="column-title" id={titleId}>
                    {archive ? (
                      <ArchiveIcon aria-hidden="true" weight="bold" />
                    ) : null}
                    <span>{stageName(column.stage)}</span>
                    <span className="column-count" aria-hidden="true">
                      {count}
                    </span>
                    <span className="sr-only">
                      {`, ${t("cardCount", { count })}`}
                    </span>
                  </h2>
                  {archive ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="column-toggle"
                      aria-expanded={archiveOpen}
                      aria-controls={`${titleId}-list`}
                      aria-label={
                        archiveOpen ? t("archiveHide") : t("archiveShow")
                      }
                      onClick={() => setArchiveOpen((open) => !open)}
                    >
                      {archiveOpen ? (
                        <CaretUpIcon aria-hidden="true" weight="bold" />
                      ) : (
                        <CaretDownIcon aria-hidden="true" weight="bold" />
                      )}
                    </Button>
                  ) : null}
                </header>
                {over === column.stage ? (
                  <p className="column-drop" aria-hidden="true">
                    {t("dropHere")}
                  </p>
                ) : null}
                {collapsed ? (
                  <div className="column-folded" id={`${titleId}-list`}>
                    <ArchiveSummary cards={column.visible} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setArchiveOpen(true)}
                    >
                      {t("archiveShow")}
                    </Button>
                  </div>
                ) : column.visible.length ? (
                  <ol className="column-list" id={`${titleId}-list`}>
                    {column.visible.map((card) => (
                      <li key={card.id}>
                        <BoardCard
                          card={card}
                          now={now}
                          draggable={canDrag}
                          dragging={dragging?.id === card.id}
                          onDragStart={setDragging}
                          onDragEnd={() => {
                            setDragging(null);
                            setOver(null);
                          }}
                          onMove={(target, stage) => move(target, stage)}
                          onArchive={askArchive}
                        />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="column-empty" id={`${titleId}-list`}>
                    {filtered && column.items.length
                      ? t("emptyFiltered")
                      : t("empty")}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </section>
      <p className="board-hint">{t("dragHint")}</p>

      <ArchiveDialog
        company={asking?.company ?? ""}
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        onPick={(reason) => {
          if (asking) move(asking, "archived", reason);
          setAsking(null);
        }}
      />
    </>
  );
}

/** The folded archive: how many left the funnel, and why. */
function ArchiveSummary({ cards }: { cards: ApplicationCard[] }) {
  const reasons = useTranslations("reasons");
  const counts = new Map<ArchiveReason, number>();
  for (const card of cards)
    if (card.archiveReason)
      counts.set(card.archiveReason, (counts.get(card.archiveReason) ?? 0) + 1);
  if (!counts.size) return null;
  return (
    <ul className="archive-summary">
      {[...counts.entries()].map(([reason, n]) => (
        <li key={reason}>
          <span>{reasons(reason)}</span>
          <span className="archive-summary-n">{n}</span>
        </li>
      ))}
    </ul>
  );
}
