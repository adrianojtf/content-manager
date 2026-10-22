import { DynamicModule, Module } from '@nestjs/common';
import { ListPublicationComments, SyncPublicationComments } from '../../../src/application/social/sync-publication-comments';
import { SetCommentLike } from '../../../src/application/social/set-comment-like';
import { SocialCommentsController } from '../../../src/presentation/http/social-comments.controller';

@Module({})
class SocialCommentsE2eModule {}

export function createSocialCommentsE2eModule(
  syncComments: Pick<SyncPublicationComments, 'execute'>,
  listComments: Pick<ListPublicationComments, 'execute'> = { execute: async () => [] },
  likeComment: Pick<SetCommentLike, 'execute'> = { execute: async () => ({ appLiked: false }) },
): DynamicModule {
  return {
    module: SocialCommentsE2eModule,
    controllers: [SocialCommentsController],
    providers: [
      { provide: SyncPublicationComments, useValue: syncComments },
      { provide: ListPublicationComments, useValue: listComments },
      { provide: SetCommentLike, useValue: likeComment },
    ],
  };
}
