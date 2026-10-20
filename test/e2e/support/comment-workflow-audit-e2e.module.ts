import { DynamicModule, Module } from '@nestjs/common';
import {
  CorrectCommentAnalysis,
  ListCommentWorkflow,
  RecordManualResponse,
  ReviseManualResponse,
  ReviseResponseSuggestion,
} from '../../../src/application/social/comment-workflow-audit';
import { EvaluateResponseSuggestion } from '../../../src/application/social/comment-intelligence.usecases';
import { SendManualCommentReply } from '../../../src/application/social/send-manual-comment-reply';
import { CommentWorkflowAuditController } from '../../../src/presentation/http/comment-workflow-audit.controller';

@Module({})
class CommentWorkflowAuditE2eModule {}

export function createCommentWorkflowAuditE2eModule(options: {
  readonly corrections: Pick<CorrectCommentAnalysis, 'execute'>;
  readonly revisions: Pick<ReviseResponseSuggestion, 'execute'>;
  readonly manualResponses?: Pick<RecordManualResponse, 'execute'>;
  readonly manualResponseRevisions?: Pick<ReviseManualResponse, 'execute'>;
  readonly evaluateResponse?: Pick<EvaluateResponseSuggestion, 'execute'>;
  readonly sendReply?: Pick<SendManualCommentReply, 'execute'>;
  readonly history: Pick<ListCommentWorkflow, 'execute'>;
}): DynamicModule {
  return {
    module: CommentWorkflowAuditE2eModule,
    controllers: [CommentWorkflowAuditController],
    providers: [
      { provide: CorrectCommentAnalysis, useValue: options.corrections },
      { provide: ReviseResponseSuggestion, useValue: options.revisions },
      { provide: RecordManualResponse, useValue: options.manualResponses ?? { execute: async () => ({}) } },
      { provide: ReviseManualResponse, useValue: options.manualResponseRevisions ?? { execute: async () => ({}) } },
      { provide: EvaluateResponseSuggestion, useValue: options.evaluateResponse ?? { execute: async () => ({}) } },
      { provide: SendManualCommentReply, useValue: options.sendReply ?? { execute: async () => ({}) } },
      { provide: ListCommentWorkflow, useValue: options.history },
    ],
  };
}
