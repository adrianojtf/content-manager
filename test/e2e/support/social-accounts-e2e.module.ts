import { DynamicModule, Module } from '@nestjs/common';
import { DisconnectSocialAccount } from '../../../src/application/social/disconnect-social-account';
import { ListConnectedSocialAccounts } from '../../../src/application/social/list-connected-social-accounts';
import { SocialAccountsController } from '../../../src/presentation/http/social-accounts.controller';

@Module({})
class SocialAccountsE2eModule {}

export function createSocialAccountsE2eModule(
  listAccounts: Pick<ListConnectedSocialAccounts, 'execute'>,
  disconnectAccount: Pick<DisconnectSocialAccount, 'execute'>,
): DynamicModule {
  return {
    module: SocialAccountsE2eModule,
    controllers: [SocialAccountsController],
    providers: [
      { provide: ListConnectedSocialAccounts, useValue: listAccounts },
      { provide: DisconnectSocialAccount, useValue: disconnectAccount },
    ],
  };
}
