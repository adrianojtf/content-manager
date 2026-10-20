import type { SocialAccount, SocialPlatform } from '../../domain/social/social-account';

export interface PlatformPublication {
  readonly platform: SocialPlatform;
  readonly externalPublicationId: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly permalink: string | null;
  readonly thumbnailUrl: string | null;
  readonly publishedAt: string | null;
}

export interface PlatformPublicationPage {
  readonly items: readonly PlatformPublication[];
  readonly nextCursor: string | null;
}

export interface SocialPublicationReader {
  listPublications(account: SocialAccount, cursor?: string): Promise<PlatformPublicationPage>;
}
