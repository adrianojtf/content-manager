import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { AnalyzeResponseRefinementPairs } from '../../application/social/analyze-response-refinement-pairs';

@Controller('social/response-refinement')
export class ResponseRefinementAnalysisController {
  constructor(private readonly analyze: AnalyzeResponseRefinementPairs) {}

  @Post('analyses')
  async create(@Body() body: unknown) {
    if (!this.isRecord(body) || !this.isValidBody(body)) {
      throw new HttpException({ code: 'RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID' }, 400);
    }
    try {
      return await this.analyze.execute({
        confirmExternalProcessing: body.confirmExternalProcessing === true,
        ...(typeof body.accountId === 'string' ? { accountId: body.accountId } : {}),
        ...(typeof body.platform === 'string' ? { platform: body.platform } : {}),
        ...(typeof body.language === 'string' ? { language: body.language } : {}),
        ...(typeof body.from === 'string' ? { from: body.from } : {}),
        ...(typeof body.to === 'string' ? { to: body.to } : {}),
        ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
        ...(typeof body.after === 'string' || body.after === null ? { after: body.after } : {}),
        ...(typeof body.retryClassificationFromAnalysisRequestId === 'string'
          ? { retryClassificationFromAnalysisRequestId: body.retryClassificationFromAnalysisRequestId }
          : {}),
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isValidBody(body: Readonly<Record<string, unknown>>): boolean {
    const allowed = new Set([
      'confirmExternalProcessing', 'accountId', 'platform', 'language', 'from', 'to',
      'limit', 'after', 'retryClassificationFromAnalysisRequestId',
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key))) return false;
    return (body.confirmExternalProcessing === undefined || typeof body.confirmExternalProcessing === 'boolean')
      && (body.accountId === undefined || typeof body.accountId === 'string')
      && (body.platform === undefined || typeof body.platform === 'string')
      && (body.language === undefined || typeof body.language === 'string')
      && (body.from === undefined || typeof body.from === 'string')
      && (body.to === undefined || typeof body.to === 'string')
      && (body.limit === undefined || typeof body.limit === 'number')
      && (body.after === undefined || body.after === null || typeof body.after === 'string')
      && (body.retryClassificationFromAnalysisRequestId === undefined
        || typeof body.retryClassificationFromAnalysisRequestId === 'string');
  }

  private throwHttpError(error: unknown): never {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
    if (code === 'RESPONSE_REFINEMENT_CONSENT_REQUIRED'
      || code === 'RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID'
      || code === 'RESPONSE_REFINEMENT_ANALYSIS_UNAVAILABLE') {
      const status = code === 'RESPONSE_REFINEMENT_CONSENT_REQUIRED' ? 403
        : code === 'RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID' ? 400
          : 503;
      throw new HttpException({ code }, status);
    }
    throw new HttpException({ code: 'RESPONSE_REFINEMENT_ANALYSIS_UNAVAILABLE' }, 503);
  }
}
