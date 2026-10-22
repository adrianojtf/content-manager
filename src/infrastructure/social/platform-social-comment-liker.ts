import type {
  PlatformComment,
  SocialCommentLikeAction,
  SocialCommentLiker,
  SocialCommentLikerRegistry,
} from '../../application/ports/social-comment.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';

export class PlatformSocialCommentLiker implements SocialCommentLiker {
  constructor(private readonly likers: SocialCommentLikerRegistry) {}

  setLike(account: SocialAccount, comment: PlatformComment, action: SocialCommentLikeAction): Promise<void> {
    const liker = this.likers[account.platform];
    if (!liker) throw new SocialProviderError('SOCIAL_COMMENT_LIKE_UNSUPPORTED');
    return liker.setLike(account, comment, action);
  }
}
