import {
  battleshipFeatures,
  type Cosmetics,
  defaultCosmetics,
  type PlayerProfile,
  type ServerMessage,
  type ServerPayload,
} from "@outegro/contracts/battleship";
import { makeAutoObservable, runInAction } from "mobx";
import type { SocketStatus } from "../transport/game-socket";

export type PlayerSummary = ServerPayload<"player.updated">["player"];

/** Where a fresh profile comes from (the BFF in the app, a stub in tests). */
export interface ProfileSource {
  fetchProfile(): Promise<PlayerProfile | null>;
}

/**
 * Who is playing and how the game connection is doing. The profile comes
 * from the server render and `/api/me`; the live summary from the socket
 * (`session.ready`, `player.updated`), so a purchase shows up without a
 * reload (TC-BS-09).
 */
export class SessionStore {
  signedIn: boolean;
  profile: PlayerProfile | null;
  summary: PlayerSummary | null = null;
  connection: SocketStatus = "idle";
  attempts = 0;
  nextRetryAt: number | null = null;
  rtt: number | null = null;
  profileState: "idle" | "loading" | "error" = "idle";
  /** The match the server says is running; undefined until the first session.ready. */
  activeMatchId: string | null | undefined = undefined;

  constructor(
    initial: { signedIn: boolean; profile: PlayerProfile | null },
    private readonly source: ProfileSource,
  ) {
    this.signedIn = initial.signedIn;
    this.profile = initial.profile;
    makeAutoObservable<SessionStore, "source">(
      this,
      { source: false },
      { autoBind: true },
    );
  }

  get nickname(): string | null {
    return this.summary?.nickname ?? this.profile?.nickname ?? null;
  }

  get rating(): number | null {
    return this.summary?.rating ?? this.profile?.rating ?? null;
  }

  get premium(): boolean {
    return this.summary?.premium ?? this.profile?.premium ?? false;
  }

  /** Granted features; the live Premium flag counts even before a profile refresh. */
  get features(): ReadonlySet<string> {
    const features = new Set(this.profile?.features ?? []);
    if (this.premium) features.add(battleshipFeatures.premium);
    else if (this.summary) features.delete(battleshipFeatures.premium);
    return features;
  }

  /** What the board shows: the server's effective cosmetics. */
  get cosmetics(): Cosmetics {
    return (
      this.summary?.cosmetics ??
      this.profile?.cosmetics.effective ??
      defaultCosmetics
    );
  }

  /** What the player chose (may exceed what is unlocked right now). */
  get equipped(): Cosmetics {
    return this.profile?.cosmetics.equipped ?? this.cosmetics;
  }

  get online(): boolean {
    return this.connection === "ready";
  }

  hasFeature(feature: string): boolean {
    return this.features.has(feature);
  }

  setSignedIn(signedIn: boolean, profile: PlayerProfile | null): void {
    this.signedIn = signedIn;
    if (!signedIn) this.summary = null;
    this.setProfile(profile);
  }

  setConnection(
    status: SocketStatus,
    attempts: number,
    nextRetryAt: number | null,
  ): void {
    this.connection = status;
    this.attempts = attempts;
    this.nextRetryAt = nextRetryAt;
  }

  setRtt(rtt: number): void {
    this.rtt = rtt;
  }

  /** A fresh profile from the server wins over an older live summary. */
  setProfile(profile: PlayerProfile | null): void {
    this.profile = profile;
    if (profile && this.summary) {
      this.summary = {
        nickname: profile.nickname,
        rating: profile.rating,
        premium: profile.premium,
        cosmetics: profile.cosmetics.effective,
      };
    }
  }

  handle(message: ServerMessage): void {
    if (message.type === "session.ready") {
      this.summary = message.payload.player;
      this.activeMatchId = message.payload.activeMatchId;
    } else if (message.type === "player.updated") {
      this.summary = message.payload.player;
      // Features (e.g. a one-time purchase) are only in the full profile.
      void this.refreshProfile();
    }
  }

  async refreshProfile(): Promise<PlayerProfile | null> {
    this.profileState = "loading";
    try {
      const profile = await this.source.fetchProfile();
      runInAction(() => {
        this.profileState = "idle";
        if (profile) this.setProfile(profile);
      });
      return profile;
    } catch {
      runInAction(() => {
        this.profileState = "error";
      });
      return null;
    }
  }
}
