import { BadGatewayException, BadRequestException, Body, Controller, Get, HttpException, Post, Query, Redirect, ServiceUnavailableException, Header } from '@nestjs/common';
import { SocialCredentialVaultError } from '../../infrastructure/persistence/social-credential-vault-error';
import { BeginInstagramOAuth } from '../../application/social/begin-instagram-oauth';
import { CompleteInstagramOAuth } from '../../application/social/complete-instagram-oauth';
import { InstagramOAuthError } from '../../application/social/instagram-oauth-error';

const instagramOAuthErrorCodes = new Set([
  'INSTAGRAM_OAUTH_STATE_INVALID', 'INSTAGRAM_OAUTH_DENIED', 'INSTAGRAM_OAUTH_CODE_REQUIRED',
  'INSTAGRAM_OAUTH_CONFIGURATION_REQUIRED', 'INSTAGRAM_OAUTH_CONFIGURATION_INVALID',
  'INSTAGRAM_OAUTH_TOKEN_EXCHANGE_FAILED', 'INSTAGRAM_OAUTH_TOKEN_REFRESH_FAILED', 'INSTAGRAM_OAUTH_SCOPE_MISSING',
  'INSTAGRAM_OAUTH_ACCOUNT_INVALID', 'INSTAGRAM_OAUTH_ACCOUNT_ID_MISMATCH', 'INSTAGRAM_OAUTH_PROVIDER_UNAVAILABLE',
  'INSTAGRAM_OAUTH_RESPONSE_INVALID', 'INSTAGRAM_OAUTH_CREDENTIAL_CLEANUP_FAILED',
]);

@Controller('social/connections')
export class InstagramOAuthConnectionController {
  constructor(
    private readonly begin: BeginInstagramOAuth,
    private readonly complete: CompleteInstagramOAuth,
  ) {}

  @Get('instagram/authorize')
  @Redirect()
  async authorize(): Promise<{ url: string; statusCode: 302 }> {
    try {
      const { authorizationUrl } = await this.begin.execute();
      return { url: authorizationUrl, statusCode: 302 };
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Get('instagram/callback')
  @Header('Cache-Control', 'no-store')
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
    const code = error instanceof InstagramOAuthError
      ? error.code
      : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && instagramOAuthErrorCodes.has(error.code)
        ? error.code
        : null;
    if (code) {
      const status = code === 'INSTAGRAM_OAUTH_CONFIGURATION_REQUIRED'
        || code === 'INSTAGRAM_OAUTH_CONFIGURATION_INVALID'
        || code === 'INSTAGRAM_OAUTH_CREDENTIAL_CLEANUP_FAILED'
        ? 503
        : code === 'INSTAGRAM_OAUTH_PROVIDER_UNAVAILABLE'
          || code === 'INSTAGRAM_OAUTH_TOKEN_EXCHANGE_FAILED'
          || code === 'INSTAGRAM_OAUTH_TOKEN_REFRESH_FAILED'
          || code === 'INSTAGRAM_OAUTH_RESPONSE_INVALID'
          ? 502
          : 400;
      throw new HttpException({ code }, status);
    }
    if (error instanceof SocialCredentialVaultError) throw new ServiceUnavailableException({ code: error.code });
    if (error instanceof BadRequestException || error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
    throw new BadGatewayException({ code: 'INSTAGRAM_OAUTH_FAILED' });
  }
}
