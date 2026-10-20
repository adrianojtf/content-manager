import { BadGatewayException, BadRequestException, Controller, Get, HttpException, Redirect, Query, ServiceUnavailableException } from '@nestjs/common';
import { SocialCredentialVaultError } from '../../infrastructure/persistence/social-credential-vault-error';
import { BeginYouTubeOAuth } from '../../application/social/begin-youtube-oauth';
import { CompleteYouTubeOAuth } from '../../application/social/complete-youtube-oauth';
import { YouTubeOAuthError } from '../../application/social/youtube-oauth-error';

@Controller('social/connections')
export class YouTubeOAuthConnectionController {
  constructor(
    private readonly begin: BeginYouTubeOAuth,
    private readonly complete: CompleteYouTubeOAuth,
  ) {}

  @Get('youtube/authorize')
  @Redirect()
  async authorize(@Query('enableReplies') enableReplies?: string): Promise<{ url: string; statusCode: 302 }> {
    try {
      const { authorizationUrl } = await this.begin.execute({ enableReplies: enableReplies === 'true' });
      return { url: authorizationUrl, statusCode: 302 };
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Get('youtube/callback')
  async callback(
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') providerError?: string,
  ) {
    try {
      return await this.complete.execute({ state, code, providerError });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    if (error instanceof YouTubeOAuthError) {
      const status = error.code === 'YOUTUBE_OAUTH_CONFIGURATION_REQUIRED'
        || error.code === 'YOUTUBE_OAUTH_CONFIGURATION_INVALID'
        || error.code === 'YOUTUBE_OAUTH_CREDENTIAL_CLEANUP_FAILED'
        ? 503
        : error.code === 'YOUTUBE_OAUTH_PROVIDER_UNAVAILABLE'
          || error.code === 'YOUTUBE_OAUTH_TOKEN_EXCHANGE_FAILED'
          || error.code === 'YOUTUBE_OAUTH_RESPONSE_INVALID'
          || error.code === 'YOUTUBE_OAUTH_CHANNEL_NOT_FOUND'
            ? 502
            : 400;
      throw new HttpException({ code: error.code }, status);
    }
    if (error instanceof SocialCredentialVaultError) {
      throw new ServiceUnavailableException({ code: error.code });
    }
    if (error instanceof BadRequestException || error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
      throw error;
    }
    throw new BadGatewayException({ code: 'YOUTUBE_OAUTH_FAILED' });
  }
}
