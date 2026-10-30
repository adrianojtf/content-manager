import { Controller, Get, Header, HttpException, Query } from '@nestjs/common';
import { ListSentRepliesReport } from '../../application/social/list-sent-replies-report';
import type { SentRepliesReportErrorCode } from '../../application/social/sent-replies-report-error';

@Controller('social/replies')
export class SentRepliesReportController {
  constructor(private readonly listReport: ListSentRepliesReport) {}

  @Get('report')
  async list(@Query() query: Record<string, string | undefined>) {
    try {
      return await this.listReport.execute(query);
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Get('report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="sent-replies.csv"')
  async exportCsv(@Query() query: Record<string, string | undefined>) {
    try {
      return await this.listReport.exportCsv(query);
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
    if (code && isSentRepliesReportErrorCode(code)) {
      const statusByCode: Record<SentRepliesReportErrorCode, number> = {
        SENT_REPLIES_REPORT_FILTER_INVALID: 400,
        SENT_REPLIES_REPORT_CURSOR_INVALID: 400,
        SENT_REPLIES_REPORT_DATA_INVALID: 500,
      };
      throw new HttpException({ code }, statusByCode[code]);
    }
    throw new HttpException({ code: 'SENT_REPLIES_REPORT_FAILED' }, 500);
  }
}

function isSentRepliesReportErrorCode(value: string): value is SentRepliesReportErrorCode {
  return value === 'SENT_REPLIES_REPORT_FILTER_INVALID'
    || value === 'SENT_REPLIES_REPORT_CURSOR_INVALID'
    || value === 'SENT_REPLIES_REPORT_DATA_INVALID';
}
