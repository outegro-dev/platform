import { Module } from "@nestjs/common";
import {
  type GatewayConfig,
  gatewayConfig,
  type ProvidersConfig,
  providersConfig,
} from "../config/config.js";
import { loadProfiles } from "../domain/profiles.js";
import { ClaudeProvider } from "../providers/claude.provider.js";
import { CodexProvider } from "../providers/codex.provider.js";
import { MinimaxProvider } from "../providers/minimax.provider.js";
import { LLM_PROVIDERS } from "../providers/provider.js";
import { GatewayController } from "./gateway.controller.js";
import { GatewayMetrics } from "./gateway.metrics.js";
import { GatewayService, PROFILES } from "./gateway.service.js";

@Module({
  controllers: [GatewayController],
  providers: [
    {
      provide: PROFILES,
      inject: [gatewayConfig.KEY],
      useFactory: (config: GatewayConfig) => loadProfiles(config.profilesPath),
    },
    {
      provide: LLM_PROVIDERS,
      inject: [providersConfig.KEY],
      useFactory: (config: ProvidersConfig) => [
        new CodexProvider({ command: ["codex"], codexHome: config.codexHome }),
        new ClaudeProvider({
          command: ["claude"],
          oauthToken: config.claudeOauthToken,
        }),
        new MinimaxProvider({ apiKey: config.minimaxApiKey }),
      ],
    },
    GatewayMetrics,
    GatewayService,
  ],
})
export class GatewayModule {}
