import { DynamicModule, Module } from '@nestjs/common';
import { BeginFacebookOAuth } from '../../../src/application/social/begin-facebook-oauth';
import { CompleteFacebookOAuth } from '../../../src/application/social/complete-facebook-oauth';
import { SelectFacebookPage } from '../../../src/application/social/select-facebook-page';
import { FacebookOAuthConnectionController } from '../../../src/presentation/http/facebook-oauth-connection.controller';

@Module({})
class FacebookOAuthE2eModule {}

export function createFacebookOAuthE2eModule(
  begin: Pick<BeginFacebookOAuth, 'execute'>,
  complete: Pick<CompleteFacebookOAuth, 'execute'>,
  select: Pick<SelectFacebookPage, 'execute'>,
): DynamicModule {
  return {
    module: FacebookOAuthE2eModule,
    controllers: [FacebookOAuthConnectionController],
    providers: [
      { provide: BeginFacebookOAuth, useValue: begin },
      { provide: CompleteFacebookOAuth, useValue: complete },
      { provide: SelectFacebookPage, useValue: select },
    ],
  };
}
