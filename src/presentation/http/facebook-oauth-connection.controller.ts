import { BadGatewayException, BadRequestException, Body, Controller, Get, HttpException, Post, Query, Redirect, ServiceUnavailableException, Header } from '@nestjs/common';
import { SocialCredentialVaultError } from '../../infrastructure/persistence/social-credential-vault-error';
import { BeginFacebookOAuth } from '../../application/social/begin-facebook-oauth';
import { CompleteFacebookOAuth } from '../../application/social/complete-facebook-oauth';
import { SelectFacebookPage } from '../../application/social/select-facebook-page';
import { FacebookOAuthError } from '../../application/social/facebook-oauth-error';

const facebookOAuthErrorCodes = new Set([
  'FACEBOOK_OAUTH_STATE_INVALID', 'FACEBOOK_OAUTH_DENIED', 'FACEBOOK_OAUTH_CODE_REQUIRED',
  'FACEBOOK_OAUTH_CONFIGURATION_REQUIRED', 'FACEBOOK_OAUTH_CONFIGURATION_INVALID',
  'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED', 'FACEBOOK_OAUTH_SCOPE_MISSING', 'FACEBOOK_OAUTH_NO_MANAGED_PAGES',
  'FACEBOOK_OAUTH_PAGE_ACCESS_UNAVAILABLE', 'FACEBOOK_OAUTH_PAGE_SELECTION_INVALID',
  'FACEBOOK_OAUTH_PROVIDER_UNAVAILABLE', 'FACEBOOK_OAUTH_RESPONSE_INVALID', 'FACEBOOK_OAUTH_CREDENTIAL_CLEANUP_FAILED',
]);

interface SelectFacebookPageBody {
  readonly selectionId?: unknown;
  readonly pageId?: unknown;
}

@Controller('social/connections')
export class FacebookOAuthConnectionController {
  constructor(
    private readonly begin: BeginFacebookOAuth,
    private readonly complete: CompleteFacebookOAuth,
    private readonly selectPage: SelectFacebookPage,
  ) {}

  @Get('facebook/authorize')
  @Redirect()
  async authorize(): Promise<{ url: string; statusCode: 302 }> {
    try {
      const { authorizationUrl } = await this.begin.execute();
      return { url: authorizationUrl, statusCode: 302 };
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Get('facebook/callback')
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

  @Post('facebook/select')
  @Header('Cache-Control', 'no-store')
  async select(@Body() body: SelectFacebookPageBody) {
    if (typeof body?.selectionId !== 'string' || !body.selectionId.trim() || typeof body.pageId !== 'string' || !body.pageId.trim()) {
      throw new BadRequestException({ code: 'FACEBOOK_OAUTH_PAGE_SELECTION_INVALID' });
    }
    try {
      return await this.selectPage.execute({ selectionId: body.selectionId, pageId: body.pageId });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    const code = error instanceof FacebookOAuthError
      ? error.code
      : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && facebookOAuthErrorCodes.has(error.code)
        ? error.code
        : null;
    if (code) {
      const status = code === 'FACEBOOK_OAUTH_CONFIGURATION_REQUIRED'
        || code === 'FACEBOOK_OAUTH_CONFIGURATION_INVALID'
        || code === 'FACEBOOK_OAUTH_CREDENTIAL_CLEANUP_FAILED'
        ? 503
        : code === 'FACEBOOK_OAUTH_PROVIDER_UNAVAILABLE'
          || code === 'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED'
          || code === 'FACEBOOK_OAUTH_RESPONSE_INVALID'
          ? 502
          : 400;
      throw new HttpException({ code }, status);
    }
    if (error instanceof SocialCredentialVaultError) throw new ServiceUnavailableException({ code: error.code });
    if (error instanceof BadRequestException || error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
    throw new BadGatewayException({ code: 'FACEBOOK_OAUTH_FAILED' });
  }
}
