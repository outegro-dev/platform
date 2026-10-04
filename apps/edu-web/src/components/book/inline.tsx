import type { Inline } from "@outegro/contracts/edu";
import { safeHref } from "@outegro/edu-engine";
import { Fragment, type ReactNode } from "react";

/**
 * Inline text of a book as React elements: plain strings stay text (React
 * escapes them), marks map to their HTML elements, and a link renders only
 * for https pages and in-page anchors. Never HTML injection. Server and
 * client components share it (the simulator's notes, the deck's cards).
 */
export function InlineText({ nodes }: { nodes: readonly Inline[] }) {
  return <>{nodes.map((node, index) => renderNode(node, index))}</>;
}

function children(node: { c?: unknown }): readonly Inline[] {
  return Array.isArray(node.c) ? (node.c as Inline[]) : [];
}

function renderNode(node: Inline, key: number): ReactNode {
  if (typeof node === "string") return <Fragment key={key}>{node}</Fragment>;
  switch (node.t) {
    case "code":
      return <code key={key}>{node.v}</code>;
    case "b":
      return (
        <strong key={key}>
          <InlineText nodes={children(node)} />
        </strong>
      );
    case "i":
      return (
        <em key={key}>
          <InlineText nodes={children(node)} />
        </em>
      );
    case "dfn":
      return (
        <dfn key={key}>
          <InlineText nodes={children(node)} />
        </dfn>
      );
    case "sup":
      return (
        <sup key={key}>
          <InlineText nodes={children(node)} />
        </sup>
      );
    case "sub":
      return (
        <sub key={key}>
          <InlineText nodes={children(node)} />
        </sub>
      );
    case "u":
      return (
        <u key={key}>
          <InlineText nodes={children(node)} />
        </u>
      );
    case "a": {
      const content = <InlineText nodes={children(node)} />;
      const link = safeHref(node.href);
      if (!link) return <Fragment key={key}>{content}</Fragment>;
      return link.external ? (
        <a key={key} href={link.href} target="_blank" rel="noopener noreferrer">
          {content}
        </a>
      ) : (
        <a key={key} href={link.href}>
          {content}
        </a>
      );
    }
    case "br":
      return <br key={key} />;
    default:
      return null;
  }
}
