import { DynamicModule, Module } from '@nestjs/common';
import { ListCommentWorkflowBatchEvents, RunCommentWorkflowBatch } from '../../../src/application/social/run-comment-workflow-batch';
import { CommentWorkflowBatchController } from '../../../src/presentation/http/comment-workflow-batch.controller';

@Module({})
class CommentWorkflowBatchE2eModule {}

export function createCommentWorkflowBatchE2eModule(options: {
  readonly batch: Pick<RunCommentWorkflowBatch, 'execute'>;
  readonly events: Pick<ListCommentWorkflowBatchEvents, 'execute'>;
}): DynamicModule {
  return {
    module: CommentWorkflowBatchE2eModule,
    controllers: [CommentWorkflowBatchController],
    providers: [
      { provide: RunCommentWorkflowBatch, useValue: options.batch },
      { provide: ListCommentWorkflowBatchEvents, useValue: options.events },
    ],
  };
}
