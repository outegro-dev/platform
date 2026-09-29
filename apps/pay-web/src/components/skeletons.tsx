import type { CSSProperties } from "react";
import { Spinner } from "./spinner";

/*
 * Loading placeholders with the exact boxes of the content they stand for.
 * The first box carries the visible "Loading …" text (role=status), so the
 * loading state is described in words and nothing moves when data arrives.
 */

const block = (width: CSSProperties["width"], height: number) => (
  <span className="skeleton" style={{ width, height }} />
);

function LoadingNote({ text }: { text: string }) {
  return (
    <p className="loading-note" role="status">
      <Spinner />
      {text}
    </p>
  );
}

export function OrderListSkeleton({ label }: { label: string }) {
  return (
    <div className="order-list" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="card order-row">
          <span className="service-mark" aria-hidden="true" />
          <div className="order-main">
            {row === 0 ? <LoadingNote text={label} /> : block("56%", 16)}
            {block(140, 12)}
          </div>
          <div className="order-cell order-cell-date">{block(96, 14)}</div>
          <div className="order-cell order-cell-amount">{block(64, 16)}</div>
          <div className="order-cell order-cell-status">{block(104, 30)}</div>
          <span className="order-chevron" />
        </div>
      ))}
    </div>
  );
}

export function OrderDetailSkeleton({ label }: { label: string }) {
  return (
    <div className="order-layout" aria-busy="true">
      <div className="order-column">
        <div className="hero-card">
          <span className="orb" aria-hidden="true">
            <span className="orb-ring" />
          </span>
          <div className="hero-copy">
            <LoadingNote text={label} />
            {block("70%", 30)}
            {block("92%", 14)}
            {block("64%", 14)}
          </div>
        </div>
        <div className="card panel progress-panel">
          {block(120, 16)}
          {block("60%", 14)}
          {block("48%", 14)}
          {block("54%", 14)}
        </div>
      </div>
      <div className="order-aside">
        <div className="receipt">
          {block(140, 16)}
          {[0, 1, 2, 3, 4].map((row) => (
            <span key={row} className="receipt-row">
              {block(90, 14)}
              {block(120, 14)}
            </span>
          ))}
          {block("100%", 36)}
        </div>
      </div>
    </div>
  );
}

export function SubscriptionsSkeleton({ label }: { label: string }) {
  return (
    <div className="sub-list" aria-busy="true">
      {[0, 1].map((card) => (
        <div key={card} className="card sub-card">
          <div className="sub-head">
            <span className="service-mark" aria-hidden="true" />
            <div className="sub-name">
              {card === 0 ? <LoadingNote text={label} /> : block("48%", 19)}
              {block(160, 12)}
            </div>
            {block(96, 30)}
          </div>
          <div className="sub-facts">
            {[0, 1, 2].map((fact) => (
              <div key={fact}>
                {block(80, 12)}
                <span style={{ display: "block", height: 8 }} />
                {block(110, 16)}
              </div>
            ))}
          </div>
          <div className="sub-foot">
            {block("60%", 14)}
            {block(160, 40)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CatalogSkeleton({ label }: { label: string }) {
  return (
    <div className="catalog-group" aria-busy="true">
      <div className="catalog-group-head">
        <div className="group-name">
          <span className="service-mark" aria-hidden="true" />
          <LoadingNote text={label} />
        </div>
      </div>
      <div className="product-grid">
        {[0, 1].map((card) => (
          <div key={card} className="card product-card">
            <div className="product-top">
              {block(150, 28)}
              {block(60, 16)}
            </div>
            {block("58%", 28)}
            <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
              {block("96%", 14)}
              {block("88%", 14)}
            </div>
            <div className="product-buy">
              <div className="product-price-row">
                {block(120, 36)}
                {block(170, 44)}
              </div>
              {block("100%", 48)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
