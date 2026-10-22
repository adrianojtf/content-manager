import { DynamicModule, Module } from '@nestjs/common';
import { GetCommentSummary } from '../../../src/application/social/comment-summary';
import { SocialCommentSummaryController } from '../../../src/presentation/http/social-comment-summary.controller';

@Module({})
class CommentSummaryE2eModule {}

export function createCommentSummaryE2eModule(
  getSummary: Pick<GetCommentSummary, 'execute'>,
): DynamicModule {
  return {
    module: CommentSummaryE2eModule,
    controllers: [SocialCommentSummaryController],
    providers: [
      { provide: GetCommentSummary, useValue: getSummary },
    ],
  };
}
