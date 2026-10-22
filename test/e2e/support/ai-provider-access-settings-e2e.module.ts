import { Module } from '@nestjs/common';
import { GetAIProviderAccessStatus } from '../../../src/application/social/ai-provider-access-settings';
import { UpdateAIProviderAccessSettings } from '../../../src/application/social/ai-provider-access-settings';
import { AIProviderAccessSettingsController } from '../../../src/presentation/http/ai-provider-access-settings.controller';

let saved: Record<string, unknown> = {};

@Module({
  controllers: [AIProviderAccessSettingsController],
  providers: [
    {
      provide: GetAIProviderAccessStatus,
      useValue: {
        execute: async () => ({
          storageReady: true,
          jev: { apiKeyConfigured: Boolean(saved.jevApiKey) },
          textGeneration: {
            google: { credentialsConfigured: Boolean(saved.geminiApiKey), dataUsePolicy: 'paid-tier', dataUsePolicyConfigured: true },
            openai: { credentialsConfigured: Boolean(saved.openaiApiKey) },
          },
        }),
      },
    },
    {
      provide: UpdateAIProviderAccessSettings,
      useValue: {
        execute: async (settings: Record<string, unknown>) => {
          saved = { ...saved, ...settings };
        },
      },
    },
  ],
})
export class AIProviderAccessSettingsE2eModule {
  static reset(): void {
    saved = {};
  }
}
