"use client";

import { Button } from "@outegro/ui/button";
import {
  type AccountMenuIcon,
  type AccountMenuLink,
  type AccountMenuUser,
  accountMenuMessagesFor,
  accountMenuModel,
  type PlatformApp,
  type PlatformUrls,
} from "@outegro/ui/lib/platform";
import { cn } from "@outegro/ui/lib/utils";
import { Spinner } from "@outegro/ui/spinner";
import {
  AnchorIcon,
  BellIcon,
  CaretDownIcon,
  CheckIcon,
  CreditCardIcon,
  GlobeHemisphereWestIcon,
  type Icon,
  IdentificationCardIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SignInIcon,
  SignOutIcon,
  UserIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { DropdownMenu } from "radix-ui";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/** This app's sign-out: a POST route, or a server action. */
type SignOutAction = string | ((formData: FormData) => void | Promise<void>);

type AccountMenuProps = {
  /** Who is signed in; null shows a clear "Sign in" instead of the menu. */
  user: AccountMenuUser | null;
  /** The app showing the menu: its pages open in place, Apps marks it. */
  current: PlatformApp;
  /** Public addresses of the apps, from the host app's configuration. */
  urls: PlatformUrls;
  /** The host app's locale ("en" | "ru"); anything else reads English. */
  locale: string;
  /** Where this app's own SSO sign-in starts. */
  signInHref: string;
  /** This app's own sign-out: a POST route or a server action. */
  signOut: SignOutAction;
  /** Runs before sign-out is sent; preventDefault() stops it (e.g. offline). */
  onSignOutSubmit?: React.FormEventHandler<HTMLFormElement>;
  /** Absolute URL of this app that pay.outegro.dev offers as the way back. */
  returnTo?: string | null;
  /** Avatar and caret only, at every width (when the app shows a name already). */
  compact?: boolean;
  className?: string;
};

const icons: Record<AccountMenuIcon, Icon> = {
  profile: UserIcon,
  security: ShieldCheckIcon,
  notifications: BellIcon,
  purchases: ReceiptIcon,
  battleship: AnchorIcon,
  id: IdentificationCardIcon,
  pay: CreditCardIcon,
  admin: WrenchIcon,
  site: GlobeHemisphereWestIcon,
};

const triggerClass =
  "og-glass group inline-flex h-11 max-w-full min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-[13px] max-md:pr-1 font-medium text-foreground transition-[translate,box-shadow] duration-(--duration-fast) ease-(--ease-out) motion-safe:hover:-translate-y-px aria-busy:cursor-progress";

const itemClass =
  "relative flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-[12px] px-3 py-1.5 text-[14px] leading-tight font-medium text-foreground outline-none transition-colors duration-(--duration-fast) data-highlighted:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&_svg]:size-5 [&_svg]:shrink-0";

/**
 * The platform menu every outegro.dev app shows in its header: who is
 * signed in, their account on id.outegro.dev, purchases and subscriptions
 * on pay.outegro.dev, the other apps (the admin console only for platform
 * roles), the portfolio, and this app's own sign-out. A WAI-ARIA menu
 * button (Radix): Enter, Space and arrow keys open it, arrows and typing
 * move through it, Escape closes it and returns focus to the button.
 * Signed out, it is a single "Sign in" link.
 */
function AccountMenu({ user, ...props }: AccountMenuProps) {
  if (!user) {
    const messages = accountMenuMessagesFor(props.locale);
    return (
      <Button
        asChild
        size="sm"
        className={props.className}
        data-slot="account-menu-sign-in"
      >
        <a href={props.signInHref}>
          <SignInIcon />
          {messages.signIn}
        </a>
      </Button>
    );
  }
  return <SignedInMenu user={user} {...props} />;
}

function SignedInMenu({
  user,
  current,
  urls,
  locale,
  signOut,
  onSignOutSubmit,
  returnTo,
  compact = false,
  className,
}: Omit<AccountMenuProps, "user" | "signInHref"> & {
  user: AccountMenuUser;
}) {
  const { messages, person, groups } = accountMenuModel({
    user,
    urls,
    current,
    locale,
    returnTo,
  });
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const serverAction = typeof signOut === "function";

  return (
    <>
      {/* Not modal: the page stays in the accessibility tree (no aria-hidden
          around a focusable button) and scrollable; outside clicks, Tab and
          Escape still close the menu. */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            data-slot="account-menu-trigger"
            aria-label={`${person.title}, ${messages.menu}`}
            aria-busy={signingOut || undefined}
            title={signingOut ? messages.signingOut : undefined}
            className={cn(triggerClass, className)}
          >
            <Avatar initials={person.initials} busy={signingOut} />
            {compact ? null : (
              <span
                data-slot="account-menu-name"
                className="max-w-[180px] truncate max-md:hidden"
              >
                {person.title}
              </span>
            )}
            <CaretDownIcon
              aria-hidden="true"
              weight="bold"
              className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) group-data-[state=open]:rotate-180 max-md:hidden"
            />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            loop
            data-slot="account-menu-content"
            className="z-50 max-h-(--radix-dropdown-menu-content-available-height) w-[min(22rem,calc(100vw-1.5rem))] origin-(--radix-dropdown-menu-content-transform-origin) overflow-y-auto overscroll-contain rounded-[20px] border border-border bg-surface p-1.5 text-foreground shadow-[0_24px_64px_-24px_#1718174d,0_2px_8px_#17181712] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
          >
            <DropdownMenu.Label className="flex items-center gap-3 px-3 pt-2.5 pb-3">
              <Avatar initials={person.initials} size="lg" />
              <span className="grid min-w-0 gap-0.5">
                <span
                  className="truncate text-[15px] font-semibold"
                  data-testid="account-menu-name"
                >
                  {person.title}
                </span>
                {person.subtitle ? (
                  <span className="truncate text-[13px] text-muted-foreground">
                    {person.subtitle}
                  </span>
                ) : null}
                <span className="text-[12px] leading-snug text-muted-foreground">
                  {messages.oneSignIn}
                </span>
              </span>
            </DropdownMenu.Label>
            {groups.map((group) => {
              const labelId = `${id}-${group.key}`;
              return (
                <Fragment key={group.key}>
                  <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />
                  <DropdownMenu.Group
                    aria-labelledby={group.label ? labelId : undefined}
                  >
                    {group.label ? (
                      <DropdownMenu.Label
                        id={labelId}
                        className="og-eyebrow px-3 pt-2 pb-1"
                      >
                        {group.label}
                      </DropdownMenu.Label>
                    ) : null}
                    {group.items.map((item) => (
                      <MenuLink
                        key={item.key}
                        item={item}
                        currentLabel={messages.current}
                      />
                    ))}
                  </DropdownMenu.Group>
                </Fragment>
              );
            })}
            <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />
            <DropdownMenu.Item
              className={itemClass}
              data-testid="account-menu-sign-out"
              // The menu closes first; the form outside it stays mounted.
              onSelect={() =>
                window.setTimeout(() => form.current?.requestSubmit(), 0)
              }
            >
              <SignOutIcon
                aria-hidden="true"
                className="text-muted-foreground"
              />
              {messages.signOut}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <form
        ref={form}
        hidden
        action={signOut}
        {...(serverAction ? {} : { method: "post" })}
        onSubmit={(event) => {
          onSignOutSubmit?.(event);
          if (!event.defaultPrevented) setSigningOut(true);
        }}
      >
        {serverAction ? <SignOutProgress onSettled={setSigningOut} /> : null}
      </form>
    </>
  );
}

/** Ends the busy state if the server action returns without navigating. */
function SignOutProgress({
  onSettled,
}: {
  onSettled: (pending: boolean) => void;
}) {
  const { pending } = useFormStatus();
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending) onSettled(false);
    was.current = pending;
  }, [pending, onSettled]);
  return null;
}

function MenuLink({
  item,
  currentLabel,
}: {
  item: AccountMenuLink;
  currentLabel: string;
}) {
  const ItemIcon = icons[item.icon];
  // One spoken name, "Battleship, battleship.outegro.dev, you are here",
  // starting with the visible label; the lines below stay visual.
  const name = [item.label, item.host, item.current ? currentLabel : null]
    .filter(Boolean)
    .join(", ");
  return (
    <DropdownMenu.Item asChild className={itemClass} textValue={item.label}>
      <a
        href={item.href}
        aria-label={name}
        data-testid={`account-menu-${item.key}`}
      >
        <ItemIcon aria-hidden="true" className="text-muted-foreground" />
        <span className="grid min-w-0 flex-1">
          <span className="truncate">{item.label}</span>
          {item.host ? (
            <span className="truncate font-mono text-[11px] font-normal tracking-[0.02em] text-muted-foreground">
              {item.host}
            </span>
          ) : null}
        </span>
        {item.current ? (
          <CheckIcon
            aria-hidden="true"
            weight="bold"
            className="text-success"
          />
        ) : null}
      </a>
    </DropdownMenu.Item>
  );
}

function Avatar({
  initials,
  size = "md",
  busy = false,
}: {
  initials: string;
  size?: "md" | "lg";
  busy?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full bg-primary font-bold text-primary-foreground uppercase",
        size === "lg" ? "size-11 text-[15px]" : "size-9 text-[13px]",
      )}
    >
      {busy ? (
        <Spinner className="size-4" />
      ) : initials ? (
        initials
      ) : (
        <UserIcon weight="bold" className="size-[45%]" />
      )}
    </span>
  );
}

/**
 * The signed-in button's box while the host app still asks Identity who is
 * signed in (a Suspense fallback), so the header does not move when the
 * menu arrives. Inert and hidden from assistive technology.
 */
function AccountMenuPlaceholder({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="account-menu-placeholder"
      className={cn(triggerClass, "cursor-default", className)}
    >
      <span className="size-9 shrink-0 rounded-full bg-secondary" />
      {compact ? null : (
        <span className="h-3 w-24 rounded-full bg-secondary max-md:hidden" />
      )}
      <CaretDownIcon
        weight="bold"
        className="size-3.5 shrink-0 text-muted-foreground max-md:hidden"
      />
    </span>
  );
}

export { AccountMenu, AccountMenuPlaceholder, type AccountMenuProps };
