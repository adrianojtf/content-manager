import { Body, Controller, HttpException, Param, Post } from '@nestjs/common';
import type { CommentWorkflowAuditErrorCode } from '../../application/social/comment-workflow-audit-error';
import type { IntelligenceProviderErrorCode } from '../../application/social/intelligence-provider-error';
import type { SocialProviderErrorCode } from '../../application/social/social-provider-error';
import { EvaluateComment, GenerateCommentResponseSuggestion } from '../../application/social/comment-intelligence.usecases';

@Controller('social/accounts')
export class CommentIntelligenceController {
  constructor(
    private readonly evaluateComment: EvaluateComment,
    private readonly generateResponse: GenerateCommentResponseSuggestion,
  ) {}

  @Post(':accountId/comments/:externalCommentId/classification')
  async classify(
    @Param('accountId') accountId: string,
    @Param('externalCommentId') externalCommentId: string,
    @Body() body?: { batchOperationId?: unknown },
  ) {
    if (body?.batchOperationId !== undefined && body.batchOperationId !== null && typeof body.batchOperationId !== 'string') {
      throw new HttpException({ code: 'COMMENT_WORKFLOW_EVENT_INVALID' }, 400);
    }
    try {
      return await this.evaluateComment.execute({
        accountId,
        externalCommentId,
        batchOperationId: body?.batchOperationId as string | null | undefined,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post(':accountId/comments/:externalCommentId/responses/generate')
  async generate(
    @Param('accountId') accountId: string,
    @Param('externalCommentId') externalCommentId: string,
    @Body() body: { language?: unknown; analysisEventId?: unknown; batchOperationId?: unknown },
  ) {
    if (typeof body?.language !== 'string' || !body.language.trim()
      || (body.analysisEventId !== undefined && body.analysisEventId !== null && typeof body.analysisEventId !== 'string')
      || (body.batchOperationId !== undefined && body.batchOperationId !== null && typeof body.batchOperationId !== 'string')) {
      throw new HttpException({ code: 'RESPONSE_SUGGESTION_INVALID' }, 400);
    }
    try {
      return await this.generateResponse.execute({
        accountId,
        externalCommentId,
        language: body.language,
        analysisEventId: body.analysisEventId as string | undefined,
        batchOperationId: body.batchOperationId as string | null | undefined,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null;
    const statusByCode: Partial<Record<CommentWorkflowAuditErrorCode | SocialProviderErrorCode | IntelligenceProviderErrorCode, number>> = {
      SOCIAL_ACCOUNT_NOT_FOUND: 404,
      SOCIAL_COMMENT_TEXT_UNAVAILABLE: 422,
      COMMENT_NOT_FOUND: 404,
      COMMENT_ANALYSIS_NOT_FOUND: 409,
      COMMENT_ANALYSIS_INVALID: 502,
      RESPONSE_SUGGESTION_INVALID: 400,
      COMMENT_WORKFLOW_EVENT_INVALID: 400,
      INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED: 503,
      INTELLIGENCE_PROVIDER_CONFIGURATION_INVALID: 503,
      INTELLIGENCE_PROVIDER_DATA_POLICY_REQUIRED: 409,
      INTELLIGENCE_PROVIDER_AUTHORIZATION_FAILED: 502,
      INTELLIGENCE_PROVIDER_RATE_LIMITED: 429,
      INTELLIGENCE_PROVIDER_UNAVAILABLE: 503,
      INTELLIGENCE_PROVIDER_REQUEST_FAILED: 502,
      INTELLIGENCE_PROVIDER_RESPONSE_INVALID: 502,
      INTELLIGENCE_PROVIDER_RESPONSE_BLOCKED: 422,
    };
    if (code === 'SOCIAL_ACCOUNT_ID_INVALID') {
      throw new HttpException({ code }, 400);
    }
    const status = code ? statusByCode[code as keyof typeof statusByCode] : undefined;
    throw new HttpException({ code: code ?? 'COMMENT_INTELLIGENCE_FAILED' }, status ?? 502);
  }
}
