import { Body, Controller, Get, HttpException, Param, Post } from '@nestjs/common';
import type { CommentWorkflowAuditErrorCode } from '../../application/social/comment-workflow-audit-error';
import {
  CorrectCommentAnalysis,
  ListCommentWorkflow,
  RecordManualResponse,
  ReviseManualResponse,
  ReviseResponseSuggestion,
} from '../../application/social/comment-workflow-audit';
import { EvaluateResponseSuggestion } from '../../application/social/comment-intelligence.usecases';
import { SendManualCommentReply } from '../../application/social/send-manual-comment-reply';

@Controller('social/accounts')
export class CommentWorkflowAuditController {
  constructor(
    private readonly correctAnalysisUseCase: CorrectCommentAnalysis,
    private readonly reviseSuggestionUseCase: ReviseResponseSuggestion,
    private readonly recordManualResponseUseCase: RecordManualResponse,
    private readonly reviseManualResponseUseCase: ReviseManualResponse,
    private readonly evaluateResponseUseCase: EvaluateResponseSuggestion,
    private readonly sendReplyUseCase: SendManualCommentReply,
    private readonly listWorkflow: ListCommentWorkflow,
  ) {}

  @Get(':accountId/comments/:externalCommentId/workflow')
  async history(@Param('accountId') accountId: string, @Param('externalCommentId') externalCommentId: string) {
    try {
      return await this.listWorkflow.execute({ accountId, externalCommentId });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post(':accountId/comments/:externalCommentId/analysis/:analysisEventId/corrections')
  async correctAnalysis(
    @Param('accountId') accountId: string,
    @Param('externalCommentId') externalCommentId: string,
    @Param('analysisEventId') analysisEventId: string,
    @Body() body: { correctedFields?: unknown; reason?: unknown },
  ) {
    if (!this.isRecord(body?.correctedFields) || (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string')) {
      throw new HttpException({ code: 'COMMENT_ANALYSIS_CORRECTION_INVALID' }, 400);
    }
    try {
      return await this.correctAnalysisUseCase.execute({
        accountId,
        externalCommentId,
        analysisEventId,
        correctedFields: body.correctedFields,
        reason: body.reason as string | null | undefined,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post(':accountId/comments/:externalCommentId/suggestions/:suggestionEventId/revisions')
  async reviseSuggestion(
    @Param('accountId') accountId: string,
    @Param('externalCommentId') externalCommentId: string,
    @Param('suggestionEventId') suggestionEventId: string,
    @Body() body: { text?: unknown; previousRevisionId?: unknown; reason?: unknown },
  ) {
    if (typeof body?.text !== 'string' || (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string')
      || (body.previousRevisionId !== undefined && body.previousRevisionId !== null && typeof body.previousRevisionId !== 'string')) {
      throw new HttpException({ code: 'RESPONSE_SUGGESTION_REVISION_INVALID' }, 400);
    }
    try {
      return await this.reviseSuggestionUseCase.execute({
        accountId,
        externalCommentId,
        suggestionEventId,
        previousRevisionId: body.previousRevisionId as string | null | undefined,
        text: body.text,
        reason: body.reason as string | null | undefined,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post(':accountId/comments/:externalCommentId/responses/manual')
  async createManualResponse(
    @Param('accountId') accountId: string,
    @Param('externalCommentId') externalCommentId: string,
    @Body() body: { text?: unknown; reason?: unknown },
  ) {
    if (typeof body?.text !== 'string' || (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string')) {
      throw new HttpException({ code: 'MANUAL_RESPONSE_INVALID' }, 400);
    }
    try {
      return await this.recordManualResponseUseCase.execute({ accountId, externalCommentId, text: body.text, reason: body.reason as string | null | undefined });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post(':accountId/comments/:externalCommentId/responses/manual/:responseEventId/revisions')
  async reviseManualResponse(
    @Param('accountId') accountId: string,
    @Param('externalCommentId') externalCommentId: string,
    @Param('responseEventId') responseEventId: string,
    @Body() body: { text?: unknown; previousRevisionId?: unknown; reason?: unknown },
  ) {
    if (typeof body?.text !== 'string' || (body.previousRevisionId !== undefined && body.previousRevisionId !== null && typeof body.previousRevisionId !== 'string')
      || (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string')) {
      throw new HttpException({ code: 'MANUAL_RESPONSE_INVALID' }, 400);
    }
    try {
      return await this.reviseManualResponseUseCase.execute({ accountId, externalCommentId, responseEventId, previousRevisionId: body.previousRevisionId as string | null | undefined, text: body.text, reason: body.reason as string | null | undefined });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post(':accountId/comments/:externalCommentId/revisions/:revisionEventId/evaluation')
  async evaluateResponse(
    @Param('accountId') accountId: string,
    @Param('externalCommentId') externalCommentId: string,
    @Param('revisionEventId') revisionEventId: string,
  ) {
    try {
      return await this.evaluateResponseUseCase.execute({ accountId, externalCommentId, revisionEventId });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post(':accountId/comments/:externalCommentId/revisions/:revisionEventId/send')
  async sendReply(
    @Param('accountId') accountId: string,
    @Param('externalCommentId') externalCommentId: string,
    @Param('revisionEventId') revisionEventId: string,
  ) {
    try {
      return await this.sendReplyUseCase.execute({ accountId, externalCommentId, revisionEventId });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private throwHttpError(error: unknown): never {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null;
    const statusByCode: Partial<Record<CommentWorkflowAuditErrorCode, number>> = {
      COMMENT_NOT_FOUND: 404,
      COMMENT_ANALYSIS_NOT_FOUND: 404,
      RESPONSE_SUGGESTION_NOT_FOUND: 404,
      COMMENT_ANALYSIS_INVALID: 400,
      COMMENT_ANALYSIS_CORRECTION_INVALID: 400,
      RESPONSE_SUGGESTION_INVALID: 400,
      RESPONSE_SUGGESTION_REVISION_INVALID: 400,
      MANUAL_RESPONSE_INVALID: 400,
      MANUAL_RESPONSE_NOT_FOUND: 404,
      RESPONSE_EVALUATION_INVALID: 400,
      RESPONSE_EVALUATION_REVISION_STALE: 409,
      MANUAL_REPLY_REVISION_STALE: 409,
      MANUAL_REPLY_ATTEMPT_ALREADY_EXISTS: 409,
      MANUAL_REPLY_ATTEMPT_FAILED: 502,
      COMMENT_WORKFLOW_EVENT_INVALID: 400,
      COMMENT_WORKFLOW_EVENT_PARENT_NOT_FOUND: 404,
    };
    if (code === 'SOCIAL_ACCOUNT_ID_INVALID') {
      throw new HttpException({ code }, 400);
    }
    if (code === 'SOCIAL_ACCOUNT_NOT_FOUND') {
      throw new HttpException({ code }, 404);
    }
    if (code === 'SOCIAL_REPLY_UNSUPPORTED') {
      throw new HttpException({ code }, 409);
    }
    const status = code ? statusByCode[code as CommentWorkflowAuditErrorCode] : undefined;
    throw new HttpException({ code: code ?? 'COMMENT_WORKFLOW_FAILED' }, status ?? 502);
  }
}
