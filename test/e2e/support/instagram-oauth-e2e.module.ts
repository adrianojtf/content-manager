import { DynamicModule, Module } from '@nestjs/common';
import { BeginInstagramOAuth } from '../../../src/application/social/begin-instagram-oauth';
import { CompleteInstagramOAuth } from '../../../src/application/social/complete-instagram-oauth';
import { InstagramOAuthConnectionController } from '../../../src/presentation/http/instagram-oauth-connection.controller';

@Module({})
class InstagramOAuthE2eModule {}

export function createInstagramOAuthE2eModule(begin: Pick<BeginInstagramOAuth, 'execute'>, complete: Pick<CompleteInstagramOAuth, 'execute'>): DynamicModule {
  return {
    module: InstagramOAuthE2eModule,
    controllers: [InstagramOAuthConnectionController],
    providers: [
      { provide: BeginInstagramOAuth, useValue: begin },
      { provide: CompleteInstagramOAuth, useValue: complete },
    ],
  };
}
