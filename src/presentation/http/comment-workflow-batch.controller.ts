import { Body, Controller, Get, HttpException, Param, Post } from '@nestjs/common';
import type { CommentWorkflowBatchOperation, CommentWorkflowBatchScope } from '../../application/social/run-comment-workflow-batch';
import type { SocialPlatform } from '../../domain/social/social-account';
import { CommentWorkflowAuditError } from '../../application/social/comment-workflow-audit-error';
import { SocialProviderError } from '../../application/social/social-provider-error';
import { ListCommentWorkflowBatchEvents, RunCommentWorkflowBatch } from '../../application/social/run-comment-workflow-batch';

@Controller('social')
export class CommentWorkflowBatchController {
  constructor(
    private readonly runBatch: RunCommentWorkflowBatch,
    private readonly listBatchEvents: ListCommentWorkflowBatchEvents,
  ) {}

  @Get('workflow-batches/:batchOperationId/events')
  async batchEvents(@Param('batchOperationId') batchOperationId: string) {
    try {
      return await this.listBatchEvents.execute({ batchOperationId });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post('workflow-batches')
  async execute(@Body() body: Record<string, unknown>) {
    const allowedKeys = new Set(['operation', 'scope', 'accountId', 'publicationId', 'externalCommentId', 'platform', 'language']);
    const allowedOperations = new Set(['sync', 'classify', 'generate']);
    const allowedScopes = new Set(['comment', 'publication', 'account', 'platform']);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowedKeys.has(key))
      || typeof body.operation !== 'string' || !allowedOperations.has(body.operation)
      || typeof body.scope !== 'string' || !allowedScopes.has(body.scope)) {
      throw new HttpException({ code: 'COMMENT_WORKFLOW_BATCH_INPUT_INVALID' }, 400);
    }
    try {
      return await this.runBatch.execute({
        operation: body.operation as CommentWorkflowBatchOperation,
        scope: body.scope as CommentWorkflowBatchScope,
        accountId: body.accountId as string | undefined,
        publicationId: body.publicationId as string | undefined,
        externalCommentId: body.externalCommentId as string | undefined,
        platform: body.platform as SocialPlatform | undefined,
        language: body.language as string | undefined,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    if (error instanceof CommentWorkflowAuditError) {
      const status = error.code === 'COMMENT_NOT_FOUND' ? 404 : 400;
      throw new HttpException({ code: error.code }, status);
    }
    if (error instanceof SocialProviderError) {
      const status = error.code === 'SOCIAL_ACCOUNT_NOT_FOUND' ? 404 : 422;
      throw new HttpException({ code: error.code }, status);
    }
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'COMMENT_WORKFLOW_BATCH_FAILED';
    throw new HttpException({ code }, 502);
  }
}
