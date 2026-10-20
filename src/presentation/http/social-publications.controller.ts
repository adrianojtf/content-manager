import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ListSocialPublications } from '../../application/social/list-social-publications';

@Controller('social')
export class SocialPublicationsController {
  constructor(private readonly publications: ListSocialPublications) {}

  @Get('publications')
  async list(
    @Query('accountId') accountId?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (cursor && !accountId) {
      throw new BadRequestException({ code: 'SOCIAL_PUBLICATION_CURSOR_REQUIRES_ACCOUNT' });
    }
    const results = await this.publications.execute({
      accountId,
      cursors: accountId && cursor ? { [accountId]: cursor } : undefined,
    });
    if (accountId && !results.length) {
      throw new NotFoundException({ code: 'SOCIAL_ACCOUNT_NOT_FOUND' });
    }
    return results;
  }
}
