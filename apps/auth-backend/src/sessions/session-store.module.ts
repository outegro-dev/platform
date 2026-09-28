import { Module } from "@nestjs/common";
import { RefreshStore } from "./refresh-store.js";

@Module({ providers: [RefreshStore], exports: [RefreshStore] })
export class SessionStoreModule {}
