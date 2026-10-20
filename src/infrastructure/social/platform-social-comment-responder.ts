import type { SocialCommentResponder, SocialCommentResponderRegistry, PlatformComment, PlatformCommentReply } from '../../application/ports/social-comment.port';
import type { SocialAccount } from '../../domain/social/social-account';
import { SocialProviderError } from '../../application/social/social-provider-error';

export class PlatformSocialCommentResponder implements SocialCommentResponder {
  constructor(private readonly responders: SocialCommentResponderRegistry) {}

  reply(account: SocialAccount, comment: PlatformComment, text: string): Promise<PlatformCommentReply> {
    const responder = this.responders[account.platform];
    if (!responder) throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    return responder.reply(account, comment, text);
  }
}
