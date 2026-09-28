import type { Category, Channel, Template } from "../templates/registry.js";

export type PreferenceRow = {
  category: Category;
  channel: Channel;
  enabled: boolean;
};

/** Mandatory channels ignore opt-outs; otherwise an explicit row wins, default on. */
export function channelEnabled(
  template: Template,
  channel: Channel,
  rows: readonly PreferenceRow[],
) {
  if (template.mandatory.includes(channel)) return true;
  const row = rows.find(
    (r) => r.category === template.category && r.channel === channel,
  );
  return row ? row.enabled : true;
}
