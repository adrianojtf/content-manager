import type { SocialAccountId } from '../../domain/social/social-account-id';

export interface SocialAccountIdGenerator {
  generate(): SocialAccountId;
}
