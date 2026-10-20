import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { PlatformPublication, SocialPublicationReader } from '../ports/social-publication-reader.port';
import type { SocialPlatform } from '../../domain/social/social-account';
import type { SocialAccountId } from '../../domain/social/social-account-id';
import { SocialProviderError, type SocialProviderErrorCode } from './social-provider-error';

export type SocialPublicationReaderRegistry = Partial<Record<SocialPlatform, SocialPublicationReader>>;

export interface ListSocialPublicationsInput {
  readonly accountId?: string;
  readonly cursors?: Readonly<Record<string, string>>;
}

export interface SocialPublicationAccountSummary {
  readonly id: SocialAccountId;
  readonly platform: SocialPlatform;
  readonly externalAccountId: string;
  readonly displayName: string | null;
}

export type SocialPublicationAccountResult =
  | {
    readonly account: SocialPublicationAccountSummary;
    readonly status: 'available';
    readonly items: readonly PlatformPublication[];
    readonly nextCursor: string | null;
  }
  | {
    readonly account: SocialPublicationAccountSummary;
    readonly status: 'unsupported' | 'failed';
    readonly errorCode: SocialProviderErrorCode;
  };

export class ListSocialPublications {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly pilotTenant: PilotTenantContext,
    private readonly readers: SocialPublicationReaderRegistry,
  ) {}

  async execute(input: ListSocialPublicationsInput = {}): Promise<readonly SocialPublicationAccountResult[]> {
    const tenantId = await this.pilotTenant.resolveTenantId();
    const accounts = await this.accounts.listByTenant(tenantId);
    const scopedAccounts = input.accountId ? accounts.filter((account) => account.id === input.accountId) : accounts;
    return Promise.all(scopedAccounts.map(async (account): Promise<SocialPublicationAccountResult> => {
      const summary = {
        id: account.id,
        platform: account.platform,
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
      };
      const reader = this.readers[account.platform];
      if (!reader) {
        return { account: summary, status: 'unsupported', errorCode: 'SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED' };
      }
      try {
        const page = await reader.listPublications(account, input.cursors?.[account.id]);
        return { account: summary, status: 'available', items: page.items, nextCursor: page.nextCursor };
      } catch (error) {
        return {
          account: summary,
          status: 'failed',
          errorCode: error instanceof SocialProviderError ? error.code : 'SOCIAL_PROVIDER_UNAVAILABLE',
        };
      }
    }));
  }
}
