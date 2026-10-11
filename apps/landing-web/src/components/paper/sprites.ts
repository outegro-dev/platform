import type { StaticImageData } from "next/image";
import cloud from "@/assets/paper/cloud.webp";
import easel from "@/assets/paper/easel.webp";
import house from "@/assets/paper/house.webp";
import island from "@/assets/paper/island.webp";
import lighthouse from "@/assets/paper/lighthouse.webp";
import map from "@/assets/paper/map.webp";
import pier from "@/assets/paper/pier.webp";
import rocket from "@/assets/paper/rocket.webp";
import scaffold from "@/assets/paper/scaffold.webp";
import seagull from "@/assets/paper/seagull.webp";
import server from "@/assets/paper/server.webp";
import ship from "@/assets/paper/ship.webp";
import sun from "@/assets/paper/sun.webp";
import tree from "@/assets/paper/tree.webp";

/**
 * Hand-drawn marker cut-outs with a white paper border (transparent WebP,
 * longest side 640 px, trimmed to the sticker edge).
 */
export const sprites = {
  cloud,
  easel,
  house,
  island,
  lighthouse,
  map,
  pier,
  rocket,
  scaffold,
  seagull,
  server,
  ship,
  sun,
  tree,
} satisfies Record<string, StaticImageData>;

export type SpriteName = keyof typeof sprites;

/** Stickers of each step in the static (no-canvas) layout. */
export const stepStickers: SpriteName[][] = [
  ["house", "map"],
  ["easel", "cloud"],
  ["ship", "server"],
  ["lighthouse", "rocket"],
  ["pier", "seagull"],
];
