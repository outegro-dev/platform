/**
 * Functions that run inside the page (`page.evaluate`). Each one is
 * self-contained: Playwright sends its source text, so nothing from the
 * module scope is visible inside. Elements the engine acts on later are
 * tagged with `data-atelier-ref`.
 */

export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "file"
  | "combobox"
  | "buttons";

export type RawOption = {
  /** The input / option element (state is read from it). */
  ref: string;
  /** What to click to choose it (the input, its label or an ARIA wrapper). */
  click: string;
  label: string;
  selected: boolean;
  /** Position among `<option>`s of a native select. */
  index: number;
};

export type RawField = {
  ref: string;
  /** What to click to toggle a single checkbox (its label or ARIA wrapper). */
  click: string;
  kind: FieldKind;
  /** Label as shown, markers (`*`, "(Optional)") still in. */
  label: string;
  /** `name:… id:… ac:… type:… for:… path:… qa:… ui:…` */
  hints: string;
  placeholder: string;
  required: boolean;
  options: RawOption[] | null;
  multiple: boolean;
  /** What the field shows now (text, chosen options, file name). */
  value: string;
  answered: boolean;
  /** The nearest heading above the field. */
  section: string;
  readonly: boolean;
  /** id of the listbox a combobox controls. */
  listbox: string | null;
};

export type CollectArgs = {
  roots: string[];
  ignore: string[];
  fileNames: string[];
};

export function collectFields(args: CollectArgs): RawField[] {
  const ATTR = "data-atelier-ref";
  const store = window as unknown as { __atelierSeq?: number };
  const refOf = (el: Element): string => {
    let ref = el.getAttribute(ATTR);
    if (!ref) {
      store.__atelierSeq = (store.__atelierSeq ?? 0) + 1;
      ref = `a${store.__atelierSeq}`;
      el.setAttribute(ATTR, ref);
    }
    return ref;
  };
  const squash = (text: string) => text.replace(/\s+/g, " ").trim();
  const textOf = (el: Element | null | undefined): string =>
    el ? squash((el as HTMLElement).innerText ?? el.textContent ?? "") : "";
  const shown = (el: Element | null | undefined): boolean => {
    if (!el?.isConnected) return false;
    const check = (el as HTMLElement).checkVisibility;
    if (
      check &&
      !check.call(el, { visibilityProperty: true, checkVisibilityCSS: true })
    )
      return false;
    return true;
  };
  const visible = (el: Element | null | undefined): boolean => {
    if (!el || !shown(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const CONTROL =
    "input, select, textarea, [role=combobox], [role=radio], [role=checkbox], button[aria-pressed]";
  const WEAK =
    /^(attach|upload|browse|choose( a)? file|select( a)? file|drop (your )?files?( here)?|upload( a)? file|choose|or drag and drop here|drag and drop|replace( file)?|remove( file)?|change( file)?|delete( file)?)$/i;

  let root: Element | null = null;
  for (const selector of args.roots) {
    const found = document.querySelector(selector);
    if (found?.querySelector(CONTROL)) {
      root = found;
      break;
    }
  }
  if (!root) {
    const forms = [...document.forms].sort(
      (a, b) =>
        b.querySelectorAll(CONTROL).length - a.querySelectorAll(CONTROL).length,
    );
    const form = forms[0];
    root =
      form && form.querySelectorAll(CONTROL).length > 1 ? form : document.body;
  }
  const scope = root;
  const ignored = (el: Element) =>
    args.ignore.some((selector) => el.closest(selector) !== null);

  /** Text of a label without the text of controls inside it. */
  const labelText = (label: Element): string => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let keep = true;
      for (
        let parent = node.parentElement;
        parent && parent !== label;
        parent = parent.parentElement
      ) {
        if (
          parent.matches(
            "input, select, textarea, button, [role=listbox], [role=option], script, style",
          ) ||
          parent.querySelector("input:not([type=hidden]), select, textarea") ||
          !shown(parent)
        ) {
          keep = false;
          break;
        }
      }
      if (keep) parts.push(node.textContent ?? "");
    }
    return squash(parts.join(" "));
  };
  const byIds = (ids: string, skipWeak: boolean): string =>
    squash(
      ids
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null)
        .map((el) => textOf(el) || squash(el.textContent ?? ""))
        .filter((text) => !(skipWeak && WEAK.test(text)))
        .join(" "),
    );

  type Labelled = { text: string; el: Element | null };
  const ownLabel = (el: Element): Labelled | null => {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = byIds(labelledBy, true);
      if (text && !WEAK.test(text)) {
        const first = document.getElementById(labelledBy.split(/\s+/)[0] ?? "");
        return { text, el: first };
      }
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels) {
      for (const label of labels) {
        const text = labelText(label);
        if (text && !WEAK.test(text)) return { text, el: label };
      }
    }
    const aria = el.getAttribute("aria-label");
    if (aria && !WEAK.test(aria.trim()))
      return { text: squash(aria), el: null };
    return null;
  };

  type Option = { el: Element; click: Element; label: string };
  type Draft = {
    kind: FieldKind;
    els: Element[];
    options: Option[] | null;
    multiple: boolean;
  };

  const clickTarget = (input: Element): Element => {
    const rect = input.getBoundingClientRect();
    if (visible(input) && rect.width >= 4 && rect.height >= 4) return input;
    const aria = input.closest("[role=radio], [role=checkbox]");
    if (aria && visible(aria)) return aria;
    const label = (input as HTMLInputElement).labels?.[0];
    if (label && visible(label)) return label;
    const wrapping = input.closest("label");
    if (wrapping && visible(wrapping)) return wrapping;
    if (input.parentElement && visible(input.parentElement))
      return input.parentElement;
    return input;
  };
  const optionLabel = (input: Element): string => {
    const labels = (input as HTMLInputElement).labels;
    if (labels) {
      for (const label of labels) {
        const text = labelText(label);
        if (text) return text;
      }
    }
    const aria = input.getAttribute("aria-label");
    if (aria) return squash(aria);
    const wrapper = input.closest("[role=radio], [role=checkbox]");
    if (wrapper && textOf(wrapper)) return textOf(wrapper);
    const next = input.nextElementSibling;
    if (next && textOf(next)) return textOf(next);
    return squash((input as HTMLInputElement).value ?? "");
  };
  const groupOf = (
    input: HTMLInputElement,
    type: string,
  ): HTMLInputElement[] => {
    const all = [
      ...scope.querySelectorAll<HTMLInputElement>(`input[type=${type}]`),
    ];
    if (input.name) {
      const same = all.filter((other) => other.name === input.name);
      if (type === "radio" || same.length > 1) return same;
    }
    const container = input.closest(
      "fieldset, [role=group], [role=radiogroup]",
    );
    if (container && scope.contains(container)) {
      const boxes = [
        ...container.querySelectorAll<HTMLInputElement>(`input[type=${type}]`),
      ];
      // Several long statements in one box are separate consents, not a group.
      if (
        boxes.length > 1 &&
        boxes.length <= 80 &&
        boxes.every((box) => optionLabel(box).length <= 80)
      )
        return boxes;
    }
    return [input];
  };

  const drafts: Draft[] = [];
  const seen = new Set<Element>();
  const TEXT_TYPES: Record<string, FieldKind> = {
    email: "email",
    tel: "tel",
    url: "url",
    number: "number",
    date: "date",
  };
  for (const el of scope.querySelectorAll(CONTROL)) {
    if (seen.has(el) || ignored(el)) continue;
    const role = el.getAttribute("role");
    if (el instanceof HTMLInputElement) {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (
        [
          "hidden",
          "submit",
          "button",
          "reset",
          "image",
          "search",
          "password",
        ].includes(type) ||
        el.disabled
      )
        continue;
      if (type === "radio" || type === "checkbox") {
        // Yes/No buttons keep their value in a hidden checkbox.
        if (el.parentElement?.querySelector("button[aria-pressed]")) {
          seen.add(el);
          continue;
        }
        const members = groupOf(el, type).filter((member) => !ignored(member));
        for (const member of members) seen.add(member);
        const options = members
          .filter((member) => visible(clickTarget(member)))
          .map((member) => ({
            el: member as Element,
            click: clickTarget(member),
            label: optionLabel(member),
          }));
        if (!options.length) continue;
        if (type === "radio" || options.length > 1)
          drafts.push({
            kind: type === "radio" ? "radio" : "checkbox",
            els: options.map((option) => option.el),
            options,
            multiple: type === "checkbox",
          });
        else
          drafts.push({
            kind: "checkbox",
            els: [el],
            options: null,
            multiple: false,
          });
        continue;
      }
      if (type === "file") {
        seen.add(el);
        if (
          visible(el) ||
          visible(el.parentElement) ||
          visible(el.parentElement?.parentElement)
        )
          drafts.push({
            kind: "file",
            els: [el],
            options: null,
            multiple: false,
          });
        continue;
      }
      const combo =
        role === "combobox" ||
        ["list", "both"].includes(el.getAttribute("aria-autocomplete") ?? "");
      if (!combo && el.getAttribute("aria-hidden") === "true") continue;
      if (!visible(el) || (el.readOnly && !combo)) continue;
      seen.add(el);
      drafts.push({
        kind: combo ? "combobox" : (TEXT_TYPES[type] ?? "text"),
        els: [el],
        options: null,
        multiple: false,
      });
      continue;
    }
    if (el instanceof HTMLSelectElement) {
      seen.add(el);
      if (el.disabled || !(visible(el) || visible(el.parentElement))) continue;
      drafts.push({
        kind: "select",
        els: [el],
        options: null,
        multiple: el.multiple,
      });
      continue;
    }
    if (el instanceof HTMLTextAreaElement) {
      seen.add(el);
      if (
        el.disabled ||
        el.readOnly ||
        el.getAttribute("aria-hidden") === "true" ||
        !visible(el)
      )
        continue;
      drafts.push({
        kind: "textarea",
        els: [el],
        options: null,
        multiple: false,
      });
      continue;
    }
    if (role === "combobox") {
      seen.add(el);
      if (el.querySelector("input") || !visible(el)) continue;
      drafts.push({
        kind: "combobox",
        els: [el],
        options: null,
        multiple: false,
      });
      continue;
    }
    if (role === "radio" || role === "checkbox") {
      if (el.querySelector("input[type=radio], input[type=checkbox]")) continue;
      const container =
        el.closest("[role=radiogroup], [role=group], fieldset") ??
        el.parentElement;
      const members = container
        ? [...container.querySelectorAll(`[role=${role}]`)].filter(
            (member) => !member.querySelector("input"),
          )
        : [el];
      for (const member of members) seen.add(member);
      const options = members
        .filter((member) => visible(member))
        .map((member) => ({
          el: member,
          click: member,
          label:
            textOf(member) || squash(member.getAttribute("aria-label") ?? ""),
        }));
      if (!options.length) continue;
      if (role === "radio" || options.length > 1)
        drafts.push({
          kind: role === "radio" ? "radio" : "checkbox",
          els: options.map((option) => option.el),
          options,
          multiple: role === "checkbox",
        });
      else
        drafts.push({
          kind: "checkbox",
          els: [el],
          options: null,
          multiple: false,
        });
      continue;
    }
    if (el instanceof HTMLButtonElement && el.hasAttribute("aria-pressed")) {
      const members = el.parentElement
        ? [
            ...el.parentElement.querySelectorAll(
              ":scope > button[aria-pressed]",
            ),
          ]
        : [el];
      for (const member of members) seen.add(member);
      if (members.length < 2 || !visible(el)) continue;
      drafts.push({
        kind: "buttons",
        els: members,
        options: members.map((member) => ({
          el: member,
          click: member,
          label: textOf(member),
        })),
        multiple: false,
      });
    }
  }

  const owner = new Map<Element, number>();
  drafts.forEach((draft, index) => {
    for (const el of draft.els) owner.set(el, index);
  });
  const holdsOther = (node: Element, index: number): boolean => {
    if (owner.has(node) && owner.get(node) !== index) return true;
    for (const control of node.querySelectorAll(CONTROL)) {
      const at = owner.get(control);
      if (at !== undefined && at !== index) return true;
    }
    return false;
  };
  const commonAncestor = (els: Element[]): Element => {
    let node: Element = els[0] as Element;
    while (node.parentElement && !els.every((el) => node.contains(el)))
      node = node.parentElement;
    return node;
  };
  const LABELISH =
    "label, legend, h1, h2, h3, h4, h5, h6, [role=heading], [id$=label], [id$=Label], [class*=label], [class*=Label], [class*=question], [class*=title]";
  const pick = (candidates: Element[]): Labelled | null => {
    const withText = candidates.filter(
      (el) => shown(el) && textOf(el) && !WEAK.test(textOf(el)),
    );
    if (!withText.length) return null;
    const chosen =
      withText.find(
        (el) =>
          el.matches(LABELISH) ||
          el.querySelector("label, legend, [id$=label]"),
      ) ?? withText[0];
    return chosen ? { text: textOf(chosen), el: chosen } : null;
  };
  /** The question above a field: walks up while the ancestors hold only this field. */
  const questionOf = (draft: Draft, index: number): Labelled | null => {
    let node = commonAncestor(draft.els);
    if (draft.els.length > 1) {
      const leading: Element[] = [];
      for (const child of node.children) {
        if (
          owner.has(child) ||
          [...child.querySelectorAll(CONTROL)].some((c) => owner.has(c))
        )
          break;
        leading.push(child);
      }
      const found = pick(leading);
      if (found) return found;
    }
    for (let depth = 0; depth < 8; depth++) {
      if (depth > 0 || draft.els.length > 1) {
        const labelledBy = node.getAttribute("aria-labelledby");
        if (
          labelledBy &&
          node.matches("[role=group], [role=radiogroup], fieldset")
        ) {
          const text = byIds(labelledBy, true);
          if (text) return { text, el: document.getElementById(labelledBy) };
        }
        if (node instanceof HTMLFieldSetElement) {
          const legend = node.querySelector(":scope > legend");
          if (legend && textOf(legend))
            return { text: textOf(legend), el: legend };
        }
      }
      const leading: Element[] = [];
      for (
        let sibling = node.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      ) {
        if (holdsOther(sibling, index)) break;
        leading.unshift(sibling);
      }
      const found = pick(leading);
      if (found) return found;
      const parent = node.parentElement;
      if (!parent || parent === document.body || !scope.contains(parent)) break;
      if (holdsOther(parent, index)) break;
      node = parent;
    }
    return null;
  };
  /** The largest ancestor that holds only this field (for its shown value). */
  const boxOf = (draft: Draft, index: number): Element => {
    let node = commonAncestor(draft.els);
    for (let depth = 0; depth < 5; depth++) {
      const parent = node.parentElement;
      if (!parent || !scope.contains(parent) || holdsOther(parent, index))
        break;
      node = parent;
    }
    return node;
  };

  const headings = [
    ...document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, [role=heading], legend",
    ),
  ].filter((el) => shown(el) && textOf(el));
  const sectionOf = (el: Element): string => {
    let section = "";
    for (const heading of headings) {
      if (heading.contains(el)) continue;
      if (
        heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
      )
        section = textOf(heading);
      else break;
    }
    return section.slice(0, 300);
  };

  const isPlaceholderOption = (option: HTMLOptionElement) =>
    option.value === "" ||
    option.disabled ||
    /^(select|choose|please select|pick one|none selected|--|—)/i.test(
      option.text.trim(),
    );
  const comboValue = (el: Element): string => {
    let box: Element | null = el;
    for (let depth = 0; depth < 4 && box; depth++, box = box.parentElement) {
      const chosen = box.querySelector(
        "[class*=single-value], [class*=singleValue], [class*=multi-value__label], [class*=multiValue]",
      );
      if (chosen && textOf(chosen)) return textOf(chosen);
    }
    if (el instanceof HTMLInputElement) return el.value.trim();
    const text = textOf(el);
    return /^(select|choose)\b/i.test(text) ? "" : text;
  };
  const checked = (el: Element) =>
    (el as HTMLInputElement).checked === true ||
    el.getAttribute("aria-checked") === "true" ||
    el.getAttribute("aria-pressed") === "true";

  return drafts.map((draft, index): RawField => {
    const primary = draft.els[0] as HTMLInputElement;
    let own = draft.els.length === 1 ? ownLabel(primary) : null;
    if (!own && draft.kind === "checkbox" && !draft.options) {
      // A hidden checkbox inside an ARIA widget, or text right after the box.
      const wrapper = primary.closest("[role=checkbox][aria-labelledby]");
      const ids = wrapper?.getAttribute("aria-labelledby");
      const next = primary.nextElementSibling;
      if (ids && byIds(ids, false)) own = { text: byIds(ids, false), el: null };
      else if (next && !holdsOther(next, index) && textOf(next))
        own = { text: textOf(next), el: next };
    }
    const question = own ?? questionOf(draft, index);
    const labelEl = question?.el ?? null;
    const label = (question?.text ?? "").slice(0, 1000);
    const placeholder = squash(primary.getAttribute("placeholder") ?? "");
    const pathHolder = primary.closest("[data-field-path]");
    const hints = [
      `name:${primary.getAttribute("name") ?? ""}`,
      `id:${primary.id ?? ""}`,
      `ac:${primary.getAttribute("autocomplete") ?? ""}`,
      `type:${primary.getAttribute("type") ?? primary.tagName.toLowerCase()}`,
      `for:${labelEl?.getAttribute("for") ?? ""}`,
      `path:${pathHolder?.getAttribute("data-field-path") ?? ""}`,
      `qa:${primary.getAttribute("data-qa") ?? ""}`,
      `ui:${primary.getAttribute("data-ui") ?? ""}`,
    ].join(" ");
    const holder = primary.closest("[aria-required]");
    const required =
      draft.els.some(
        (el) =>
          (el as HTMLInputElement).required === true ||
          el.getAttribute("aria-required") === "true",
      ) ||
      (holder !== null &&
        scope.contains(holder) &&
        holder.getAttribute("aria-required") === "true") ||
      /[*✱]/.test(label) ||
      (labelEl !== null &&
        (/required/i.test(String(labelEl.getAttribute("class") ?? "")) ||
          labelEl.querySelector("[class*=required]") !== null));

    let options: RawOption[] | null = null;
    let value = "";
    let answered = false;
    if (draft.kind === "select") {
      const select = primary as unknown as HTMLSelectElement;
      options = [...select.options]
        .map((option, position) => ({ option, position }))
        .filter(({ option }) => !isPlaceholderOption(option))
        .slice(0, 400)
        .map(({ option, position }) => ({
          ref: refOf(select),
          click: refOf(select),
          label: squash(option.text),
          selected: option.selected,
          index: position,
        }));
      const chosen = [...select.selectedOptions].filter(
        (option) => !isPlaceholderOption(option),
      );
      value = chosen.map((option) => squash(option.text)).join(", ");
      answered = chosen.length > 0;
    } else if (draft.options) {
      options = draft.options.slice(0, 400).map((option, position) => ({
        ref: refOf(option.el),
        click: refOf(option.click),
        label: option.label.slice(0, 300),
        selected: checked(option.el),
        index: position,
      }));
      const chosen = options.filter((option) => option.selected);
      value = chosen.map((option) => option.label).join(", ");
      answered = chosen.length > 0;
    } else if (draft.kind === "checkbox") {
      answered = checked(primary);
      value = answered ? "checked" : "";
    } else if (draft.kind === "file") {
      const files = primary.files;
      const boxText = textOf(boxOf(draft, index));
      const shownName = args.fileNames.find((name) => boxText.includes(name));
      value = files?.[0]?.name ?? shownName ?? "";
      answered = value !== "";
    } else if (draft.kind === "combobox") {
      value = comboValue(primary);
      answered = value !== "" && value !== placeholder;
    } else {
      value = (primary.value ?? "").trim();
      answered = value !== "";
    }
    return {
      ref: refOf(primary),
      click: refOf(
        draft.kind === "checkbox" && !draft.options
          ? clickTarget(primary)
          : primary,
      ),
      kind: draft.kind,
      label,
      hints,
      placeholder,
      required,
      options,
      multiple: draft.multiple,
      value: value.slice(0, 5000),
      answered,
      section: sectionOf(primary),
      readonly: primary.readOnly === true,
      listbox:
        primary.getAttribute("aria-controls") ??
        primary.getAttribute("aria-owns") ??
        null,
    };
  });
}

export type ListOption = { ref: string; label: string };

/** Visible options of an open listbox (or any visible `[role=option]`). */
export function listOptions(args: {
  listbox: string | null;
  extra: string | null;
}): ListOption[] {
  const ATTR = "data-atelier-ref";
  const store = window as unknown as { __atelierSeq?: number };
  const refOf = (el: Element): string => {
    let ref = el.getAttribute(ATTR);
    if (!ref) {
      store.__atelierSeq = (store.__atelierSeq ?? 0) + 1;
      ref = `a${store.__atelierSeq}`;
      el.setAttribute(ATTR, ref);
    }
    return ref;
  };
  const visible = (el: Element) => {
    const check = (el as HTMLElement).checkVisibility;
    if (check && !check.call(el, { visibilityProperty: true })) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const listbox = args.listbox ? document.getElementById(args.listbox) : null;
  const scope: ParentNode = listbox?.querySelector("[role=option]")
    ? listbox
    : document;
  const nodes = [...scope.querySelectorAll("[role=option]")];
  if (args.extra) nodes.push(...document.querySelectorAll(args.extra));
  return nodes
    .filter(visible)
    .map((node) => ({
      ref: refOf(node),
      label: ((node as HTMLElement).innerText ?? node.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter(
      (option) =>
        option.label !== "" &&
        !/^(no (options|results|matches)|loading|searching|type to search)/i.test(
          option.label,
        ),
    )
    .slice(0, 300);
}

export type PageSignals = {
  url: string;
  title: string;
  /** Kind of a visible CAPTCHA challenge, null when none. */
  captcha: string | null;
  passwordField: boolean;
  loginText: boolean;
  closedText: boolean;
  /** Success text, when an adapter selector or a thank-you phrase is visible. */
  success: string | null;
  verification: boolean;
  errors: string[];
};

/** Captcha, login wall, closed posting, success and validation errors. */
export function pageSignals(args: { success: string[] }): PageSignals {
  const squash = (text: string) => text.replace(/\s+/g, " ").trim();
  const visible = (el: Element, min = 1) => {
    const check = (el as HTMLElement).checkVisibility;
    if (
      check &&
      !check.call(el, {
        visibilityProperty: true,
        opacityProperty: true,
        checkOpacity: true,
        checkVisibilityCSS: true,
      })
    )
      return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < min || rect.height < min) return false;
    // Parked off-screen (how invisible widgets keep their challenge ready).
    return rect.bottom + window.scrollY > 0 && rect.right + window.scrollX > 0;
  };
  const body = squash(document.body?.innerText ?? "");
  const head = body.slice(0, 4000);

  let captcha: string | null = null;
  for (const frame of document.querySelectorAll("iframe")) {
    const src = frame.getAttribute("src") ?? frame.src ?? "";
    const title = frame.getAttribute("title") ?? "";
    if (/hcaptcha/i.test(src) || /hcaptcha/i.test(title)) {
      if (/frame=challenge/.test(src) && visible(frame, 80))
        captcha = "hcaptcha";
      else if (/frame=checkbox(?!-invisible)/.test(src) && visible(frame, 20))
        captcha = "hcaptcha";
    } else if (/recaptcha/i.test(src)) {
      if (/bframe/.test(src) && visible(frame, 80)) captcha = "recaptcha";
      else if (
        /anchor/.test(src) &&
        !/size=invisible/.test(src) &&
        visible(frame, 20)
      )
        captcha = "recaptcha";
    } else if (/challenges\.cloudflare\.com|turnstile/i.test(src)) {
      if (visible(frame, 20)) captcha = "turnstile";
    } else if (
      /captcha-delivery|arkoselabs|funcaptcha|geetest|perimeterx/i.test(src)
    ) {
      if (visible(frame, 20)) captcha = "captcha";
    }
    if (captcha) break;
  }
  if (!captcha) {
    const widget = document.querySelector(
      ".cf-turnstile, #challenge-form, #challenge-stage, #cf-challenge-running, #px-captcha, #captcha-container, [data-captcha-challenge]",
    );
    if (widget && visible(widget, 20)) captcha = "challenge";
  }
  if (
    !captcha &&
    (/^(just a moment|attention required|access denied|security check)/i.test(
      document.title,
    ) ||
      /(verify (that )?you are (a )?human|checking (if the site connection is secure|your browser)|press (and|&) hold|i(')?m not a robot|are you a robot|unusual traffic from your)/i.test(
        head,
      ))
  )
    captcha = "challenge";

  const passwordField = [
    ...document.querySelectorAll("input[type=password]"),
  ].some((el) => visible(el));
  const loginText =
    /\b(sign|log) ?in to (apply|continue|your account)|create an account to (apply|continue)|you must (be )?(sign|log)(ged)? ?in\b/i.test(
      head,
    );
  const closedText =
    /(no longer (accepting applications|available|open)|position (has been|is) (filled|closed)|job (posting )?(is )?(not found|closed|expired|no longer)|this (job|position|posting) (has|is) (expired|closed|been closed)|page (you were looking for )?(was )?not found|\b404\b)/i.test(
      head,
    );

  let success: string | null = null;
  for (const selector of args.success) {
    const el = document.querySelector(selector);
    if (el && visible(el)) {
      success =
        squash((el as HTMLElement).innerText ?? "").slice(0, 2000) ||
        "submitted";
      break;
    }
  }
  if (!success) {
    const pattern =
      /(thank(s| you) (so much )?for (applying|your application|submitting)|application (has been |was )?(received|submitted|sent|complete)|we('ve| have) received your application|successfully (submitted|applied)|your application (was|has been) (sent|submitted|received)|application submitted)/i;
    const lines = (document.body?.innerText ?? "")
      .split(/\n+/)
      .map(squash)
      .filter(Boolean);
    const line = lines.find((text) => pattern.test(text) && text.length < 600);
    if (line) success = line.slice(0, 2000);
  }
  const verification =
    /(security code|verification code|enter the code|code (was|has been) sent|we('ve| have)? sent (you )?(a|an) .{0,30}code)/i.test(
      head,
    );

  const errors: string[] = [];
  for (const el of document.querySelectorAll(
    "[role=alert], .error, .errors, .error-message, .field-error, .invalid-feedback, [class*=error-message], [class*=errorMessage], [class*=field-error], [id$=-error], [id$=_error], [data-ui=error], [data-ui$=error], .application-error",
  )) {
    if (el.querySelector("input, select, textarea")) continue;
    if (!visible(el)) continue;
    const text = squash((el as HTMLElement).innerText ?? "");
    if (text && text.length <= 300 && !errors.includes(text)) errors.push(text);
    if (errors.length >= 10) break;
  }
  return {
    url: location.href,
    title: document.title,
    captcha,
    passwordField,
    loginText,
    closedText,
    success,
    verification,
    errors,
  };
}

/**
 * A "decline / reject / necessary only" button of a cookie banner, tagged;
 * null when there is none. Never an "accept" button.
 */
export function cookieDeclineButton(): string | null {
  const DECLINE =
    /^(decline( all| optional( cookies)?| cookies)?|reject( all)?( cookies)?|refuse( all)?|deny( all)?|(use )?(only )?(strictly )?(necessary|essential|required)( cookies)?( only)?|continue without accepting|disagree)$/i;
  const BANNER =
    /cookie|consent|gdpr|onetrust|cmp|didomi|usercentrics|cookiebot|privacy/i;
  for (const el of document.querySelectorAll(
    "button, [role=button], a[href='#'], a:not([href])",
  )) {
    const text = ((el as HTMLElement).innerText ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!DECLINE.test(text)) continue;
    let banner = false;
    for (
      let node: Element | null = el, depth = 0;
      node && depth < 8;
      node = node.parentElement, depth++
    ) {
      const marker = `${node.id} ${node.getAttribute("class") ?? ""} ${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("data-ui") ?? ""}`;
      const text = (node as HTMLElement).innerText ?? "";
      if (BANNER.test(marker) || (text.length < 3000 && /cookie/i.test(text))) {
        banner = true;
        break;
      }
    }
    if (!banner) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    let ref = el.getAttribute("data-atelier-ref");
    if (!ref) {
      ref = `cookie${Date.now()}`;
      el.setAttribute("data-atelier-ref", ref);
    }
    return ref;
  }
  return null;
}

/** Whether an input / ARIA option is selected now. */
export function isChosen(ref: string): boolean {
  const el = document.querySelector(`[data-atelier-ref="${ref}"]`);
  if (!el) return false;
  return (
    (el as HTMLInputElement).checked === true ||
    el.getAttribute("aria-checked") === "true" ||
    el.getAttribute("aria-pressed") === "true" ||
    el.getAttribute("aria-selected") === "true"
  );
}
