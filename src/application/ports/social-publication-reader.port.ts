import type { SocialAccount, SocialPlatform } from '../../domain/social/social-account';

export const socialPublicationPageSizes = [5, 10, 25] as const;
export type SocialPublicationPageSize = typeof socialPublicationPageSizes[number];
export const defaultSocialPublicationPageSize: SocialPublicationPageSize = 5;

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
  listPublications(account: SocialAccount, cursor?: string, pageSize?: SocialPublicationPageSize): Promise<PlatformPublicationPage>;
}
