import { BadGatewayException, BadRequestException, Controller, Get, Header, HttpException, Query, Redirect, ServiceUnavailableException } from '@nestjs/common';
import { SocialCredentialVaultError } from '../../infrastructure/persistence/social-credential-vault-error';
import { BeginTikTokBusinessOAuth } from '../../application/social/begin-tiktok-business-oauth';
import { CompleteTikTokBusinessOAuth } from '../../application/social/complete-tiktok-business-oauth';
import { TikTokBusinessOAuthError } from '../../application/social/tiktok-business-oauth-error';

const tikTokBusinessOAuthErrorCodes = new Set([
  'TIKTOK_BUSINESS_OAUTH_STATE_INVALID', 'TIKTOK_BUSINESS_OAUTH_DENIED', 'TIKTOK_BUSINESS_OAUTH_CODE_REQUIRED',
  'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_REQUIRED', 'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_INVALID',
  'TIKTOK_BUSINESS_OAUTH_TOKEN_EXCHANGE_FAILED', 'TIKTOK_BUSINESS_OAUTH_REFRESH_FAILED',
  'TIKTOK_BUSINESS_OAUTH_SCOPE_MISSING', 'TIKTOK_BUSINESS_OAUTH_ACCOUNT_INVALID',
  'TIKTOK_BUSINESS_OAUTH_PROVIDER_UNAVAILABLE', 'TIKTOK_BUSINESS_OAUTH_RESPONSE_INVALID',
  'TIKTOK_BUSINESS_OAUTH_CREDENTIAL_CLEANUP_FAILED',
]);

@Controller('social/connections')
export class TikTokBusinessOAuthConnectionController {
  constructor(
    private readonly begin: BeginTikTokBusinessOAuth,
    private readonly complete: CompleteTikTokBusinessOAuth,
  ) {}

  @Get('tiktok/authorize')
  @Redirect()
  async authorize(): Promise<{ url: string; statusCode: 302 }> {
    try {
      const { authorizationUrl } = await this.begin.execute();
      return { url: authorizationUrl, statusCode: 302 };
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Get('tiktok/callback')
  @Header('Cache-Control', 'no-store')
  async callback(@Query() query: Readonly<Record<string, unknown>>) {
    const stateParameter = process.env.TIKTOK_BUSINESS_STATE_PARAMETER?.trim() || 'state';
    const state = query?.[stateParameter];
    const authCode = query?.auth_code ?? query?.code;
    const providerError = query?.error;
    try {
      return await this.complete.execute({
        state: typeof state === 'string' ? state : undefined,
        authCode: typeof authCode === 'string' ? authCode : undefined,
        providerError: typeof providerError === 'string' ? providerError : undefined,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    const code = error instanceof TikTokBusinessOAuthError
      ? error.code
      : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && tikTokBusinessOAuthErrorCodes.has(error.code)
        ? error.code
        : null;
    if (code) {
      const status = code === 'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_REQUIRED'
        || code === 'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_INVALID'
        || code === 'TIKTOK_BUSINESS_OAUTH_CREDENTIAL_CLEANUP_FAILED'
        ? 503
        : code === 'TIKTOK_BUSINESS_OAUTH_PROVIDER_UNAVAILABLE'
          || code === 'TIKTOK_BUSINESS_OAUTH_TOKEN_EXCHANGE_FAILED'
          || code === 'TIKTOK_BUSINESS_OAUTH_REFRESH_FAILED'
          || code === 'TIKTOK_BUSINESS_OAUTH_RESPONSE_INVALID'
          ? 502
          : 400;
      throw new HttpException({ code }, status);
    }
    if (error instanceof SocialCredentialVaultError) throw new ServiceUnavailableException({ code: error.code });
    if (error instanceof BadRequestException || error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
    throw new BadGatewayException({ code: 'TIKTOK_BUSINESS_OAUTH_FAILED' });
  }
}
