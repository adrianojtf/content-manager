import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { defaultSocialPublicationPageSize, socialPublicationPageSizes } from '../../application/ports/social-publication-reader.port';
import { ListSocialPublications } from '../../application/social/list-social-publications';
import type { SocialPlatform } from '../../domain/social/social-account';

const socialPlatforms: readonly SocialPlatform[] = ['youtube', 'instagram', 'facebook', 'tiktok'];

@Controller('social')
export class SocialPublicationsController {
  constructor(private readonly publications: ListSocialPublications) {}

  @Get('publications')
  async list(
    @Query('accountId') accountId?: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSizeValue?: string,
    @Query('platform') platformValue?: string,
  ) {
    if (cursor && !accountId) {
      throw new BadRequestException({ code: 'SOCIAL_PUBLICATION_CURSOR_REQUIRES_ACCOUNT' });
    }
    const pageSize = pageSizeValue === undefined
      ? defaultSocialPublicationPageSize
      : socialPublicationPageSizes.find((value) => String(value) === pageSizeValue);
    if (pageSize === undefined) {
      throw new BadRequestException({ code: 'SOCIAL_PUBLICATION_PAGE_SIZE_INVALID' });
    }
    if (platformValue !== undefined && !socialPlatforms.includes(platformValue as SocialPlatform)) {
      throw new BadRequestException({ code: 'SOCIAL_PUBLICATION_PLATFORM_INVALID' });
    }
    const results = await this.publications.execute({
      accountId,
      cursors: accountId && cursor ? { [accountId]: cursor } : undefined,
      pageSize,
      platform: platformValue as SocialPlatform | undefined,
    });
    if (accountId && !results.length) {
      throw new NotFoundException({ code: 'SOCIAL_ACCOUNT_NOT_FOUND' });
    }
    return results;
  }
}
