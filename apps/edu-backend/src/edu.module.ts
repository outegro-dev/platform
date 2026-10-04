import { Module } from "@nestjs/common";
import { AdminController } from "./admin/admin.controller.js";
import { AdminService } from "./admin/admin.service.js";
import { CurrentAccessGuard } from "./admin/current-access.guard.js";
import { AssistAnswers } from "./assist/answers.js";
import { AssistController } from "./assist/assist.controller.js";
import { AssistService } from "./assist/assist.service.js";
import { AssistCache } from "./assist/cache.js";
import { AssistLedger } from "./assist/ledger.js";
import { MiniMaxModel } from "./assist/minimax.model.js";
import {
  ASSIST_TIMING,
  AssistSettings,
  defaultAssistTiming,
} from "./assist/settings.js";
import { SseResponder } from "./assist/sse.js";
import { BooksController } from "./books/books.controller.js";
import { CatalogService } from "./books/catalog.service.js";
import { LibraryService } from "./books/library.service.js";
import { EduMetrics } from "./common/metrics.js";
import { type AssistConfig, assistConfig } from "./config/config.js";
import { AssistPrompts } from "./domain/assist/prompts.js";
import { Slots } from "./domain/assist/slots.js";
import { TEXT_MODEL, type TextModel } from "./domain/assist/text-model.js";
import { GrantsConsumer } from "./events/grants.consumer.js";
import { IdentityConsumer } from "./events/identity.consumer.js";
import { ProgressController } from "./progress/progress.controller.js";
import { ProgressService } from "./progress/progress.service.js";
import { ViewerService } from "./readers/viewer.service.js";

@Module({
  controllers: [
    BooksController,
    ProgressController,
    AssistController,
    AdminController,
  ],
  providers: [
    EduMetrics,
    // Readers, grants and accounts
    ViewerService,
    GrantsConsumer,
    IdentityConsumer,
    // Books and progress
    CatalogService,
    LibraryService,
    ProgressService,
    // The reading assistant and its model
    {
      provide: TEXT_MODEL,
      inject: [assistConfig.KEY],
      useFactory: (config: AssistConfig): TextModel =>
        new MiniMaxModel({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          timeoutMs: config.timeoutMs,
        }),
    },
    {
      provide: Slots,
      inject: [assistConfig.KEY],
      useFactory: (config: AssistConfig) => new Slots(config.concurrency),
    },
    { provide: ASSIST_TIMING, useValue: defaultAssistTiming },
    { provide: AssistPrompts, useFactory: () => new AssistPrompts() },
    AssistSettings,
    AssistLedger,
    AssistCache,
    AssistAnswers,
    AssistService,
    SseResponder,
    // Admin console
    CurrentAccessGuard,
    AdminService,
  ],
})
export class EduModule {}
