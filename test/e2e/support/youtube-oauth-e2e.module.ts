import { DynamicModule, Module } from '@nestjs/common';
import { BeginYouTubeOAuth } from '../../../src/application/social/begin-youtube-oauth';
import { CompleteYouTubeOAuth } from '../../../src/application/social/complete-youtube-oauth';
import { YouTubeOAuthConnectionController } from '../../../src/presentation/http/youtube-oauth-connection.controller';

@Module({})
class YouTubeOAuthE2eModule {}

export function createYouTubeOAuthE2eModule(begin: Pick<BeginYouTubeOAuth, 'execute'>, complete: Pick<CompleteYouTubeOAuth, 'execute'>): DynamicModule {
  return {
    module: YouTubeOAuthE2eModule,
    controllers: [YouTubeOAuthConnectionController],
    providers: [
      { provide: BeginYouTubeOAuth, useValue: begin },
      { provide: CompleteYouTubeOAuth, useValue: complete },
    ],
  };
}
