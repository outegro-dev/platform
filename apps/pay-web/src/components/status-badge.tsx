import {
  ArrowUUpLeftIcon,
  CalendarXIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  HourglassMediumIcon,
  PauseCircleIcon,
  QuestionIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Subscription } from "@/lib/payments/model";
import {
  type OrderPhase,
  orderTone,
  subscriptionTone,
  type Tone,
} from "@/lib/payments/status";

function Badge({
  tone,
  icon,
  label,
}: {
  tone: Tone;
  icon: ReactNode;
  label: string;
}) {
  return (
    <span className="status" data-tone={tone}>
      {icon}
      {label}
    </span>
  );
}

/** A live dot for anything still in motion. */
const Pending = () => <span className="status-dot" aria-hidden="true" />;

const orderIcons: Record<OrderPhase, ReactNode> = {
  processing: <Pending />,
  unpaid: <HourglassMediumIcon weight="bold" aria-hidden="true" />,
  activating: <Pending />,
  paid: <CheckCircleIcon weight="fill" aria-hidden="true" />,
  failed: <XCircleIcon weight="fill" aria-hidden="true" />,
  refunded: <ArrowUUpLeftIcon weight="bold" aria-hidden="true" />,
  unknown: <QuestionIcon weight="bold" aria-hidden="true" />,
};

export function OrderStatusBadge({ phase }: { phase: OrderPhase }) {
  const t = useTranslations("status.order");
  return (
    <Badge tone={orderTone[phase]} icon={orderIcons[phase]} label={t(phase)} />
  );
}

const subscriptionIcons: Record<Subscription["state"], ReactNode> = {
  pending: <Pending />,
  active: <CheckCircleIcon weight="fill" aria-hidden="true" />,
  past_due: <WarningCircleIcon weight="fill" aria-hidden="true" />,
  cancel_requested: <Pending />,
  cancelling: <CalendarXIcon weight="bold" aria-hidden="true" />,
  expired: <ClockCounterClockwiseIcon weight="bold" aria-hidden="true" />,
  suspended: <PauseCircleIcon weight="fill" aria-hidden="true" />,
  unknown: <QuestionIcon weight="bold" aria-hidden="true" />,
};

export function SubscriptionStatusBadge({
  state,
}: {
  state: Subscription["state"];
}) {
  const t = useTranslations("status.subscription");
  return (
    <Badge
      tone={subscriptionTone[state]}
      icon={subscriptionIcons[state]}
      label={t(state)}
    />
  );
}
