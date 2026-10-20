import { SocialAccountInvariantError } from './social-account-invariant-error';

export type SocialAccountId = string & { readonly __socialAccountId: unique symbol };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSocialAccountId(value: string): SocialAccountId {
  if (!uuidPattern.test(value)) {
    throw new SocialAccountInvariantError('SOCIAL_ACCOUNT_ID_INVALID');
  }

  return value.toLowerCase() as SocialAccountId;
}
