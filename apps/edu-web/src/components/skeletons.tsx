import { Skeleton } from "@outegro/ui/skeleton";
import { Spinner } from "@outegro/ui/spinner";
import type { CSSProperties } from "react";

/*
 * Loading placeholders shaped like the pages they stand for, built from
 * the pages' own layout classes, so the swap to the real page moves as
 * little as possible. The first line carries the visible "Loading …" text
 * (role=status): the state is described in words, not only drawn.
 */

const block = (width: CSSProperties["width"], height: number) => (
  <Skeleton style={{ width, height }} />
);

function LoadingNote({ text }: { text: string }) {
  return (
    <p className="loading-note" role="status">
      <Spinner aria-hidden="true" />
      {text}
    </p>
  );
}

/** Two book cards: cover, title, lead, stats, actions. */
export function LibrarySkeleton({ label }: { label: string }) {
  return (
    <section aria-busy="true">
      <LoadingNote text={label} />
      <ul className="book-grid">
        {[0, 1].map((card) => (
          <li key={card}>
            <div className="book-card book-card-skeleton">
              <div className="book-card-cover">{block("72%", 180)}</div>
              <div className="book-card-body">
                {block(140, 12)}
                {block("62%", 34)}
                {block("94%", 16)}
                {block("80%", 16)}
                {block("70%", 14)}
                <div className="book-card-actions">
                  {block(168, 48)}
                  {block(132, 48)}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A book page: the hero with its cover, then the contents. */
export function BookSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true">
      <section className="book-hero">
        <div className="book-hero-text">
          <LoadingNote text={label} />
          {block("58%", 64)}
          {block("40%", 64)}
          {block("90%", 18)}
          {block("76%", 18)}
          {block("64%", 14)}
          <div className="book-hero-actions">{block(200, 58)}</div>
        </div>
        <div className="book-hero-cover book-cover-skeleton">
          {block("100%", 260)}
        </div>
      </section>
      <section className="contents">
        <div className="section-head">{block(180, 28)}</div>
        <ol className="contents-list">
          {[0, 1, 2, 3, 4].map((row) => (
            <li key={row} className="contents-row">
              {block(28, 16)}
              <span className="contents-body">
                {block(120, 12)}
                {block("70%", 20)}
                {block(160, 14)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * A reading page: the contents aside, the chapter's head and its text.
 * Its own classes (not the reader's landmarks or ids), so nothing on the
 * page is there twice while the real chapter streams in.
 */
export function ReaderSkeleton({ label }: { label: string }) {
  return (
    <div className="reader og-container" aria-busy="true">
      <div className="skeleton-aside">
        {block(120, 14)}
        <div className="skeleton-lines">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
            <span key={row}>{block("86%", 18)}</span>
          ))}
        </div>
      </div>
      <div className="reader-main">
        <div className="skeleton-disclosure">{block("60%", 18)}</div>
        <div className="skeleton-article">
          <LoadingNote text={label} />
          {block("88%", 40)}
          {block("64%", 40)}
          {block("96%", 18)}
          {block("82%", 18)}
          <div className="skeleton-lines">
            {[96, 100, 92, 98, 70, 100, 94, 60].map((width, row) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholder lines
              <span key={row}>{block(`${width}%`, 18)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
