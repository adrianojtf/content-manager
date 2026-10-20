import { randomUUID } from 'node:crypto';
import type { SocialAccountIdGenerator } from '../../application/ports/social-account-id-generator.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';

export class UuidSocialAccountIdGenerator implements SocialAccountIdGenerator {
  generate() {
    return parseSocialAccountId(randomUUID());
  }
}
