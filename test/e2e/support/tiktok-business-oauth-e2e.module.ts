import { DynamicModule, Module } from '@nestjs/common';
import { BeginTikTokBusinessOAuth } from '../../../src/application/social/begin-tiktok-business-oauth';
import { CompleteTikTokBusinessOAuth } from '../../../src/application/social/complete-tiktok-business-oauth';
import { TikTokBusinessOAuthConnectionController } from '../../../src/presentation/http/tiktok-business-oauth-connection.controller';

@Module({})
class TikTokBusinessOAuthE2eModule {}

export function createTikTokBusinessOAuthE2eModule(
  begin: Pick<BeginTikTokBusinessOAuth, 'execute'>,
  complete: Pick<CompleteTikTokBusinessOAuth, 'execute'>,
): DynamicModule {
  return {
    module: TikTokBusinessOAuthE2eModule,
    controllers: [TikTokBusinessOAuthConnectionController],
    providers: [
      { provide: BeginTikTokBusinessOAuth, useValue: begin },
      { provide: CompleteTikTokBusinessOAuth, useValue: complete },
    ],
  };
}
