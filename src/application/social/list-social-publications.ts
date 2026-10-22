import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { SocialPublicationRepository } from '../ports/social-publication-repository.port';
import {
  defaultSocialPublicationPageSize,
  type PlatformPublication,
  type PlatformPublicationPage,
  type SocialPublicationPageSize,
  type SocialPublicationReader,
} from '../ports/social-publication-reader.port';
import type { SocialPlatform } from '../../domain/social/social-account';
import type { SocialAccountId } from '../../domain/social/social-account-id';
import { SocialProviderError, type SocialProviderErrorCode } from './social-provider-error';

export type SocialPublicationReaderRegistry = Partial<Record<SocialPlatform, SocialPublicationReader>>;
export type SocialPublicationErrorCode = SocialProviderErrorCode | 'SOCIAL_PUBLICATION_PERSISTENCE_FAILED';

export interface ListSocialPublicationsInput {
  readonly accountId?: string;
  readonly cursors?: Readonly<Record<string, string>>;
  readonly pageSize?: SocialPublicationPageSize;
  readonly platform?: SocialPlatform;
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
    readonly errorCode: SocialPublicationErrorCode;
  };

export class ListSocialPublications {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly pilotTenant: PilotTenantContext,
    private readonly readers: SocialPublicationReaderRegistry,
    private readonly publications: SocialPublicationRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: ListSocialPublicationsInput = {}): Promise<readonly SocialPublicationAccountResult[]> {
    const tenantId = await this.pilotTenant.resolveTenantId();
    const pageSize = input.pageSize ?? defaultSocialPublicationPageSize;
    const accounts = await this.accounts.listByTenant(tenantId);
    const scopedAccounts = accounts.filter((account) => (
      (!input.accountId || account.id === input.accountId)
      && (!input.platform || account.platform === input.platform)
    ));
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
      let page: PlatformPublicationPage;
      try {
        page = await reader.listPublications(account, input.cursors?.[account.id], pageSize);
      } catch (error) {
        return {
          account: summary,
          status: 'failed',
          errorCode: error instanceof SocialProviderError ? error.code : 'SOCIAL_PROVIDER_UNAVAILABLE',
        };
      }
      if (!this.isValidPage(account.platform, page)) {
        return { account: summary, status: 'failed', errorCode: 'SOCIAL_PROVIDER_RESPONSE_INVALID' };
      }
      try {
        await this.publications.upsertPage(account, page.items, new Date(this.now()).toISOString());
      } catch (error) {
        return {
          account: summary,
          status: 'failed',
          errorCode: error instanceof SocialProviderError ? error.code : 'SOCIAL_PUBLICATION_PERSISTENCE_FAILED',
        };
      }
      return { account: summary, status: 'available', items: page.items, nextCursor: page.nextCursor };
    }));
  }

  private isValidPage(platform: SocialPlatform, page: PlatformPublicationPage): boolean {
    if (typeof page !== 'object' || page === null
      || !Array.isArray(page.items)
      || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
      return false;
    }
    const publicationIds = new Set<string>();
    for (const item of page.items) {
      if (typeof item !== 'object' || item === null
        || item.platform !== platform
        || typeof item.externalPublicationId !== 'string'
        || !item.externalPublicationId.trim()
        || publicationIds.has(item.externalPublicationId)
        || (item.title !== null && typeof item.title !== 'string')
        || (item.description !== null && typeof item.description !== 'string')
        || (item.permalink !== null && typeof item.permalink !== 'string')
        || (item.thumbnailUrl !== null && typeof item.thumbnailUrl !== 'string')
        || (item.publishedAt !== null && (typeof item.publishedAt !== 'string' || !Number.isFinite(Date.parse(item.publishedAt))))) {
        return false;
      }
      publicationIds.add(item.externalPublicationId);
    }
    return true;
  }
}
