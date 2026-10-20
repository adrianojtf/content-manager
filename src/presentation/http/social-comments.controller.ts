import { Controller, Get, HttpException, Param, Post, Query } from '@nestjs/common';
import type { SocialProviderErrorCode } from '../../application/social/social-provider-error';
import { ListPublicationComments, SyncPublicationComments } from '../../application/social/sync-publication-comments';

@Controller('social/accounts')
export class SocialCommentsController {
  constructor(
    private readonly syncComments: SyncPublicationComments,
    private readonly listComments: ListPublicationComments,
  ) {}

  @Get(':accountId/publications/:publicationId/comments')
  async list(@Param('accountId') accountId: string, @Param('publicationId') publicationId: string) {
    try {
      return await this.listComments.execute({ accountId, publicationId });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post(':accountId/publications/:publicationId/comments/sync')
  async sync(
    @Param('accountId') accountId: string,
    @Param('publicationId') publicationId: string,
    @Query('cursor') cursor?: string,
  ) {
    try {
      return await this.syncComments.execute({ accountId, publicationId, cursor });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null;
    const statusByProviderCode: Partial<Record<SocialProviderErrorCode, number>> = {
      SOCIAL_ACCOUNT_NOT_FOUND: 404,
      SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED: 422,
      SOCIAL_ACCOUNT_PERMISSION_DENIED: 422,
      SOCIAL_COMMENTS_DISABLED: 422,
      SOCIAL_REPLY_UNSUPPORTED: 422,
      SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED: 409,
      SOCIAL_PROVIDER_RATE_LIMITED: 429,
      SOCIAL_PROVIDER_RESULT_AMBIGUOUS: 409,
      SOCIAL_COMMENT_CONTEXT_MISMATCH: 409,
    };
    const status = code ? statusByProviderCode[code as SocialProviderErrorCode] : undefined;
    if (status !== undefined) {
      throw new HttpException({ code }, status);
    }
    if (code === 'SOCIAL_ACCOUNT_ID_INVALID') {
      throw new HttpException({ code }, 400);
    }
    throw new HttpException({ code: 'SOCIAL_COMMENT_SYNC_FAILED' }, 502);
  }
}
