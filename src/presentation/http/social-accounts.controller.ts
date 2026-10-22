import { BadRequestException, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param } from '@nestjs/common';
import { DisconnectSocialAccount, SocialAccountDisconnectError } from '../../application/social/disconnect-social-account';
import { ListConnectedSocialAccounts } from '../../application/social/list-connected-social-accounts';
import { SocialAccountInvariantError } from '../../domain/social/social-account-invariant-error';

@Controller('social/accounts')
export class SocialAccountsController {
  constructor(
    private readonly listAccounts: ListConnectedSocialAccounts,
    private readonly disconnectAccount: DisconnectSocialAccount,
  ) {}

  @Get()
  async list() {
    return this.listAccounts.execute();
  }

  @Delete(':accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@Param('accountId') accountId: string): Promise<void> {
    try {
      await this.disconnectAccount.execute(accountId);
    } catch (error) {
      if (error instanceof SocialAccountDisconnectError) {
        throw new NotFoundException({ code: error.code });
      }
      if (error instanceof SocialAccountInvariantError) {
        throw new BadRequestException({ code: error.code });
      }
      throw error;
    }
  }
}
