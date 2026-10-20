import { SocialAccountInvariantError } from './social-account-invariant-error';
import { parseSocialAccountId, type SocialAccountId } from './social-account-id';

export type SocialPlatform = 'youtube' | 'instagram' | 'facebook' | 'tiktok';

export interface SocialAccountInput {
  readonly id: SocialAccountId;
  readonly tenantId: string;
  readonly platform: string;
  readonly externalAccountId: string;
  readonly displayName: string | null;
  readonly credentialReference: string;
}

export class SocialAccount {
  private constructor(
    readonly id: SocialAccountId,
    readonly tenantId: string,
    readonly platform: SocialPlatform,
    readonly externalAccountId: string,
    readonly displayName: string | null,
    readonly credentialReference: string,
  ) {}

  static create(input: SocialAccountInput): SocialAccount {
    return new SocialAccount(
      parseSocialAccountId(input.id),
      this.requiredText(input.tenantId, 'SOCIAL_ACCOUNT_TENANT_REQUIRED'),
      this.supportedPlatform(input.platform),
      this.requiredText(input.externalAccountId, 'SOCIAL_ACCOUNT_EXTERNAL_ID_REQUIRED'),
      input.displayName?.trim() || null,
      this.requiredText(input.credentialReference, 'SOCIAL_ACCOUNT_CREDENTIAL_REFERENCE_REQUIRED'),
    );
  }

  static restore(input: SocialAccountInput): SocialAccount {
    return SocialAccount.create(input);
  }

  private static supportedPlatform(value: string): SocialPlatform {
    if (value !== 'youtube' && value !== 'instagram' && value !== 'facebook' && value !== 'tiktok') {
      throw new SocialAccountInvariantError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    }
    return value;
  }

  private static requiredText(value: string, code: 'SOCIAL_ACCOUNT_TENANT_REQUIRED' | 'SOCIAL_ACCOUNT_EXTERNAL_ID_REQUIRED' | 'SOCIAL_ACCOUNT_CREDENTIAL_REFERENCE_REQUIRED'): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new SocialAccountInvariantError(code);
    }
    return normalized;
  }
}
