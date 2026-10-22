import { Controller, Get, HttpException } from '@nestjs/common';
import { GetCommentSummary } from '../../application/social/comment-summary';
import type { SocialProviderErrorCode } from '../../application/social/social-provider-error';

@Controller('social/comments')
export class SocialCommentSummaryController {
  constructor(private readonly getSummary: GetCommentSummary) {}

  @Get('summary')
  async summary() {
    try {
      return await this.getSummary.execute();
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null;
      const statusByCode: Partial<Record<SocialProviderErrorCode, number>> = {
        SOCIAL_PROVIDER_RESPONSE_INVALID: 502,
        SOCIAL_PROVIDER_UNAVAILABLE: 502,
        SOCIAL_PROVIDER_CONFIGURATION_REQUIRED: 503,
        SOCIAL_PROVIDER_CONFIGURATION_INVALID: 503,
      };
      const status = code ? statusByCode[code as SocialProviderErrorCode] : undefined;
      if (status !== undefined) {
        throw new HttpException({ code }, status);
      }
      throw new HttpException({ code: 'SOCIAL_COMMENT_SUMMARY_FAILED' }, 500);
    }
  }
}
