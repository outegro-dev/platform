import type {
  HistoryItem,
  OwnBet,
  RouletteErrorCode,
  RouletteServerMessage,
  RoundView,
  TableView,
} from "@outegro/contracts/roulette";
import type { Color } from "@outegro/roulette-engine";
import { makeAutoObservable } from "mobx";
import {
  applyQuick,
  checkAmount,
  parseAmount,
  type QuickAction,
} from "../amount";
import { isMegaRound } from "../effects";
import type { MessageSender, SocketStatus } from "../transport/roulette-socket";
import { Clock } from "./clock";

/** How many results the store keeps for the history row and its counts. */
export const HISTORY_LIMIT = 100;
/** The amount the field starts with. */
export const DEFAULT_AMOUNT = 100;

/** What the line under the amount says. */
export type Notice =
  | { kind: "hint" }
  | { kind: "accepted"; color: Color; amount: number }
  | { kind: "won"; payout: number }
  | { kind: "lost" }
  | {
      kind: "refused";
      code: RouletteErrorCode | "not_connected" | "bad_amount";
    };

/** The signed-in player; the balance in grumbles is null while nobody has said it. */
export type Player = { nickname: string; balance: number | null };

/** A spin as the strip draws it: from the last result to this round's. */
export type Spin = {
  from: { number: number; seed?: string };
  to: { number: number; seed: string };
  /** Server epoch ms. */
  startAt: number;
  durationMs: number;
  /** Every third round spins further and sharper. */
  mega: boolean;
};

export type StoreOptions = {
  socket: MessageSender;
  clock?: Clock;
  /** A fresh clientBetId per click. */
  uuid?: () => string;
  /** The signed-in player as the server rendered the page (before the socket). */
  player?: Player | null;
  /**
   * The wallet's own figure (the BFF's `/api/wallet`), for when the game
   * says the balance is unknown; null when the wallet cannot say either.
   */
  readWallet?: () => Promise<number | null>;
};

/**
 * The roulette screen's state: the session, the current round as the server
 * broadcasts it, the player's own bets and balance, the amount field and the
 * notice under it. Fed by the socket; the screen only reads it and calls
 * `placeBet` and the quick buttons.
 */
export class RouletteStore {
  status: SocketStatus = "idle";
  player: Player | null;
  table: TableView | null = null;
  round: RoundView | null = null;
  /** Newest first. */
  history: HistoryItem[] = [];
  /** Your accepted bets in the current round. */
  myBets: OwnBet[] = [];
  amount = DEFAULT_AMOUNT;
  notice: Notice = { kind: "hint" };
  /** Bets sent and not answered yet, by seq. */
  pending = new Set<number>();
  /** Revealed seeds of the last few rounds: where the strip stops inside a tile. */
  seeds = new Map<number, string>();
  readonly clock: Clock;
  private readonly socket: MessageSender;
  private readonly uuid: () => string;
  private readonly readWallet: (() => Promise<number | null>) | null;
  private unsubscribe: (() => void)[] = [];

  constructor(options: StoreOptions) {
    this.socket = options.socket;
    this.clock = options.clock ?? new Clock();
    this.uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());
    this.readWallet = options.readWallet ?? null;
    this.player = options.player ? { ...options.player } : null;
    makeAutoObservable<
      RouletteStore,
      "socket" | "uuid" | "unsubscribe" | "readWallet"
    >(
      this,
      {
        socket: false,
        uuid: false,
        unsubscribe: false,
        clock: false,
        readWallet: false,
      },
      { autoBind: true },
    );
  }

  /**
   * A balance from anywhere (a bet, a payout, the bonus of the day). null
   * keeps the figure we have; the wallet is then asked for a fresh one.
   */
  setBalance(balance: number | null): void {
    if (balance !== null) {
      if (this.player) this.player.balance = balance;
      return;
    }
    void this.refreshBalance();
  }

  /** Reads the wallet directly; an answer without a figure changes nothing. */
  async refreshBalance(): Promise<void> {
    if (!this.readWallet) return;
    const balance = await this.readWallet().catch(() => null);
    if (balance !== null) this.setBalance(balance);
  }

  /** Subscribes to the socket and connects. */
  start(): void {
    if (this.unsubscribe.length > 0) return;
    this.unsubscribe = [
      this.socket.on("status", this.setStatus),
      this.socket.on("message", this.receive),
      this.socket.on("pong", ({ t, serverTime, receivedAt }) =>
        this.clock.syncPong(t, serverTime, receivedAt),
      ),
    ];
    this.socket.start();
  }

  stop(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.socket.stop();
  }

  retry(): void {
    this.socket.retryNow();
  }

  setStatus(status: SocketStatus): void {
    this.status = status;
    if (status !== "ready") this.pending.clear();
  }

  receive(message: RouletteServerMessage): void {
    switch (message.type) {
      case "session.ready": {
        const { payload } = message;
        this.clock.sync(payload.serverTime);
        const known = this.player?.balance ?? null;
        this.player = {
          nickname: payload.player.nickname,
          balance: payload.player.balance ?? known,
        };
        if (payload.player.balance === null) void this.refreshBalance();
        this.table = payload.table;
        this.history = payload.history.slice(0, HISTORY_LIMIT);
        this.myBets = payload.yourBets;
        this.round = null;
        if (payload.round) this.applyRound(payload.round);
        return;
      }
      case "round.state":
        this.applyRound(message.payload.round);
        return;
      case "bet.accepted": {
        const { bet, balance } = message.payload;
        if (message.ref !== undefined) this.pending.delete(message.ref);
        if (!this.round || bet.round >= this.round.round) {
          if (!this.myBets.some((known) => known.betId === bet.betId))
            this.myBets.push(bet);
        }
        this.setBalance(balance);
        if (message.ref !== undefined)
          this.notice = {
            kind: "accepted",
            color: bet.color,
            amount: bet.amount,
          };
        return;
      }
      case "balance": {
        const { balance, payout } = message.payload;
        this.setBalance(balance);
        this.notice = payout > 0 ? { kind: "won", payout } : { kind: "lost" };
        return;
      }
      case "error": {
        const { code, ref } = message.payload;
        if (ref !== null) this.pending.delete(ref);
        this.notice = { kind: "refused", code };
        return;
      }
      case "pong":
        return;
    }
  }

  /** A broadcast frame: a new round resets your bets; a settled one joins the history. */
  private applyRound(view: RoundView): void {
    const previous = this.round;
    if (previous && view.round < previous.round) return;
    if (!previous || view.round !== previous.round) {
      this.myBets = this.myBets.filter((bet) => bet.round >= view.round);
      if (view.phase === "betting" && this.notice.kind !== "refused")
        this.notice = { kind: "hint" };
    }
    if (view.result && !this.seeds.has(view.round)) {
      this.seeds.set(view.round, view.result.seed);
      for (const round of [...this.seeds.keys()])
        if (round < view.round - 4) this.seeds.delete(round);
    }
    if (
      view.phase === "settled" &&
      view.result &&
      this.history[0]?.round !== view.round
    ) {
      this.history = [
        {
          round: view.round,
          number: view.result.number,
          color: view.result.color,
        },
        ...this.history.filter((item) => item.round !== view.round),
      ].slice(0, HISTORY_LIMIT);
    }
    this.round = view;
  }

  get balance(): number | null {
    return this.player?.balance ?? null;
  }

  /** The spin of the current round, once its number is known. */
  get spin(): Spin | null {
    const round = this.round;
    // A voided round never spins: its bets went back.
    if (!round?.result || !this.table || round.phase === "voided") return null;
    const startAt = round.rollingAt
      ? Date.parse(round.rollingAt)
      : round.settleAt
        ? Date.parse(round.settleAt) - this.table.timings.rollingMs
        : null;
    if (startAt === null || Number.isNaN(startAt)) return null;
    const previous = this.history.find((item) => item.round < round.round);
    return {
      from: previous
        ? { number: previous.number, seed: this.seeds.get(previous.round) }
        : { number: round.result.number },
      to: { number: round.result.number, seed: round.result.seed },
      startAt,
      durationMs: this.table.timings.rollingMs,
      mega: isMegaRound(round.round),
    };
  }

  /** What the strip shows at rest: the last result. */
  get rest(): { number: number; seed?: string } | null {
    const last = this.history[0];
    return last
      ? { number: last.number, seed: this.seeds.get(last.round) }
      : null;
  }

  get canBet(): boolean {
    return (
      this.status === "ready" &&
      this.round?.phase === "betting" &&
      !this.round.table.paused
    );
  }

  /** Your bets on a colour in the current round. */
  betsOn(color: Color): OwnBet[] {
    return this.myBets.filter(
      (bet) => bet.color === color && bet.round === this.round?.round,
    );
  }

  setAmountText(text: string): void {
    const value = parseAmount(text);
    if (text.trim() === "") this.amount = 0;
    else if (value !== null) this.amount = value;
  }

  quick(action: QuickAction): void {
    const maxBet = this.table?.maxBet ?? Number.MAX_SAFE_INTEGER;
    this.amount = applyQuick(this.amount, action, {
      balance: this.balance ?? maxBet,
      maxBet,
    });
  }

  /** Sends a bet on a colour, after the checks the server would make. */
  placeBet(color: Color): void {
    if (this.status !== "ready" || !this.table) {
      this.notice = { kind: "refused", code: "not_connected" };
      return;
    }
    if (this.round?.phase !== "betting") {
      this.notice = { kind: "refused", code: "round_closed" };
      return;
    }
    if (this.round.table.paused) {
      this.notice = { kind: "refused", code: "bets_paused" };
      return;
    }
    const placed = this.myBets.filter(
      (bet) => bet.round === this.round?.round,
    ).length;
    if (placed + this.pending.size >= this.table.betsPerRound) {
      this.notice = { kind: "refused", code: "too_many_bets" };
      return;
    }
    const refusal = checkAmount(this.amount, {
      // An unknown balance is the wallet's to judge.
      balance: this.balance ?? Number.MAX_SAFE_INTEGER,
      minBet: this.table.minBet,
      maxBet: this.table.maxBet,
    });
    if (refusal) {
      this.notice = { kind: "refused", code: refusal };
      return;
    }
    const seq = this.socket.send("bet.place", {
      clientBetId: this.uuid(),
      color,
      amount: this.amount,
    });
    if (seq === null) {
      this.notice = { kind: "refused", code: "not_connected" };
      return;
    }
    this.pending.add(seq);
  }
}
