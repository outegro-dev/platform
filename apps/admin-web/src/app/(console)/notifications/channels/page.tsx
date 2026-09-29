import {
  EnvelopeSimpleIcon,
  PaperPlaneTiltIcon,
  PauseIcon,
  PlayIcon,
  TelegramLogoIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  sendTestMessage,
  setChannel,
} from "@/app/(console)/notifications/actions";
import { ActionButton } from "@/components/ui/action-button";
import { ActionDialog } from "@/components/ui/action-dialog";
import { Time } from "@/components/ui/data";
import { Facts, Panel, Status } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { externalChannels } from "@/lib/adapters/notifications";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import {
  channelSettings,
  notificationsOverview,
  telegramStatus,
} from "@/lib/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications.channels");
  return { title: t("title") };
}

async function Switches({ granted }: { granted: ReadonlySet<string> }) {
  const t = await getTranslations("notifications.channels");
  const label = await getLabels();
  const [settings, overview] = await Promise.all([
    channelSettings(),
    notificationsOverview(),
  ]);
  if (!settings.ok) {
    return (
      <Panel id="switches" title={t("switches")}>
        <FailureState failure={settings} what={t("what")} />
      </Panel>
    );
  }
  const canFlag = granted.has("services.flags");
  const { version, channels, updatedAt, updatedBy } = settings.data;
  const info = overview.ok ? overview.data.channels : null;
  return (
    <Panel
      id="switches"
      title={t("switches")}
      note={updatedAt ? undefined : t("neverChanged")}
    >
      {updatedAt && (
        <p className="small muted">
          {t("lastChange")} <Time iso={updatedAt} />
          {updatedBy && (
            <>
              {" · "}
              <Link href={`/users/${updatedBy}`} className="link mono">
                {shortId(updatedBy)}
              </Link>
            </>
          )}
          {" · "}
          <span className="mono">v{version}</span>
        </p>
      )}
      <div className="grid-2">
        {externalChannels.map((channel) => {
          const enabled = channels[channel].enabled;
          const configured =
            channel === "email" || (info?.telegram.configured ?? true);
          const name = label("channel", channel);
          return (
            <section
              key={channel}
              className="health"
              aria-labelledby={`channel-${channel}`}
            >
              <div className="health-head">
                <span className="row-gap" style={{ gap: 10 }}>
                  {channel === "email" ? (
                    <EnvelopeSimpleIcon aria-hidden="true" size={20} />
                  ) : (
                    <TelegramLogoIcon aria-hidden="true" size={20} />
                  )}
                  <h3 className="health-name" id={`channel-${channel}`}>
                    {name}
                  </h3>
                </span>
                <Status
                  tone={!configured ? "neutral" : enabled ? "ok" : "warn"}
                >
                  {!configured
                    ? t("notConfigured")
                    : enabled
                      ? t("running")
                      : t("paused")}
                </Status>
              </div>
              <p className="health-meta">
                {channel === "email"
                  ? info
                    ? t("emailInfo", {
                        provider: info.email.provider,
                        from: info.email.from,
                      })
                    : t("emailInfoUnknown")
                  : info?.telegram.botUsername
                    ? t("telegramInfo", { bot: info.telegram.botUsername })
                    : t("telegramInfoUnknown")}
              </p>
              {canFlag ? (
                <div className="row-gap">
                  {enabled ? (
                    <ActionDialog
                      action={setChannel}
                      triggerLabel={t("pause", { channel: name })}
                      triggerIcon={<PauseIcon aria-hidden="true" />}
                      title={t("pauseTitle", { channel: name })}
                      description={t("pauseDescription")}
                      consequences={[
                        t("pauseEffect"),
                        t("pauseTtl"),
                        t("otherChannels"),
                        t("audited"),
                      ]}
                      confirmLabel={t("pauseConfirm")}
                      destructive
                      hidden={{
                        channel,
                        enabled: "false",
                        expectedVersion: String(version),
                      }}
                    />
                  ) : (
                    <ActionDialog
                      action={setChannel}
                      triggerLabel={t("resume", { channel: name })}
                      triggerVariant="primary"
                      triggerIcon={<PlayIcon aria-hidden="true" />}
                      title={t("resumeTitle", { channel: name })}
                      description={t("resumeDescription")}
                      consequences={[t("resumeEffect"), t("audited")]}
                      confirmLabel={t("resumeConfirm")}
                      hidden={{
                        channel,
                        enabled: "true",
                        expectedVersion: String(version),
                      }}
                    />
                  )}
                </div>
              ) : (
                <p className="small muted">{t("needsFlags")}</p>
              )}
            </section>
          );
        })}
      </div>
    </Panel>
  );
}

async function TelegramBot() {
  const t = await getTranslations("notifications.channels");
  const result = await telegramStatus();
  if (!result.ok) {
    return (
      <Panel id="telegram" title={t("bot")}>
        <FailureState failure={result} what={t("botWhat")} />
      </Panel>
    );
  }
  const bot = result.data;
  if (!bot.configured) {
    return (
      <Panel id="telegram" title={t("bot")}>
        <p className="state-body">{t("botNotConfigured")}</p>
      </Panel>
    );
  }
  const webhook = bot.webhook;
  const mismatch =
    webhook && bot.expectedWebhookUrl && webhook.url !== bot.expectedWebhookUrl;
  return (
    <Panel
      id="telegram"
      title={t("bot")}
      note={bot.username ? `@${bot.username}` : undefined}
    >
      {bot.username === null && (
        <p className="notice" data-tone="warn">
          <WarningIcon aria-hidden="true" />
          <span>{t("botUnreachable")}</span>
        </p>
      )}
      {mismatch && (
        <p className="notice" data-tone="warn">
          <WarningIcon aria-hidden="true" />
          <span>{t("webhookMismatch")}</span>
        </p>
      )}
      {webhook?.lastError && (
        <p className="notice" data-tone="bad">
          <WarningIcon aria-hidden="true" />
          <span>
            {t("webhookError")} {webhook.lastError}
            {webhook.lastErrorAt && (
              <>
                {" · "}
                <Time iso={webhook.lastErrorAt} />
              </>
            )}
          </span>
        </p>
      )}
      <Facts
        cols={2}
        items={[
          {
            label: t("webhook"),
            value: <span className="mono break">{webhook?.url ?? "—"}</span>,
          },
          {
            label: t("expectedWebhook"),
            value: (
              <span className="mono break">
                {bot.expectedWebhookUrl ?? "—"}
              </span>
            ),
          },
          {
            label: t("pendingUpdates"),
            value: (
              <span className="num">{webhook?.pendingUpdates ?? "—"}</span>
            ),
          },
          {
            label: t("linking"),
            value: (
              <Status tone={bot.linkingAvailable ? "ok" : "neutral"}>
                {bot.linkingAvailable ? t("linkingOn") : t("linkingOff")}
              </Status>
            ),
          },
        ]}
      />
    </Panel>
  );
}

export default async function ChannelsPage() {
  const access = await pageAccess("notifications.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("notifications.channels");
  const label = await getLabels();
  return (
    <>
      <Suspense
        fallback={
          <PanelSkeleton
            label={t("switches")}
            stats={0}
            rows={3}
            className="h-panel-sm"
          />
        }
      >
        <Switches granted={access.granted} />
      </Suspense>
      <div className="grid-main">
        <Suspense
          fallback={<PanelSkeleton label={t("bot")} stats={0} rows={4} />}
        >
          <TelegramBot />
        </Suspense>
        <Panel id="test" title={t("test")} note={t("testNote")}>
          {access.granted.has("notifications.retry") ? (
            <div className="row-gap">
              {externalChannels.map((channel) => (
                <ActionButton
                  key={channel}
                  action={sendTestMessage}
                  hidden={{ channel }}
                  label={t("sendTest", { channel: label("channel", channel) })}
                  icon={<PaperPlaneTiltIcon aria-hidden="true" />}
                />
              ))}
            </div>
          ) : (
            <p className="small muted">{t("testNoPermission")}</p>
          )}
        </Panel>
      </div>
    </>
  );
}
