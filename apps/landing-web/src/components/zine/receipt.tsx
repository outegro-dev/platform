"use client";

import { useRef } from "react";
import { Barcode } from "./bits";
import { Stamp } from "./stamp";
import { useOnView } from "./use-on-view";

/**
 * What the client gets, as a till receipt that prints line by line out of a
 * slot when it scrolls into view. Every line is "included"; the total is a
 * product in production.
 */
export function Receipt({
  title,
  number,
  items,
  included,
  total,
  totalValue,
  thanks,
  stamp,
}: {
  title: string;
  number: string;
  items: { title: string; body: string }[];
  included: string;
  total: string;
  totalValue: string;
  thanks: string;
  stamp: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useOnView(ref, { threshold: 0.25 });
  return (
    <div ref={ref} className="receipt-wrap" data-state={state}>
      <span className="receipt-slot" aria-hidden="true" />
      <div className="receipt">
        <p className="receipt-head">
          <span>{title}</span>
          <span>{number}</span>
        </p>
        <ol className="receipt-lines">
          {items.map((item, i) => (
            <li key={item.title}>
              <p className="receipt-line">
                <span>
                  {String(i + 1).padStart(2, "0")} {item.title}
                </span>
                <span className="receipt-dots" aria-hidden="true" />
                <span>{included}</span>
              </p>
              <p className="receipt-body">{item.body}</p>
            </li>
          ))}
        </ol>
        <p className="receipt-total">
          <span>{total}</span>
          <span>{totalValue}</span>
        </p>
        <p className="receipt-thanks">{thanks}</p>
        <Barcode code="0001-OUTEGRO-2026" />
        <Stamp text={stamp} tone="blue" className="receipt-stamp" />
      </div>
    </div>
  );
}
