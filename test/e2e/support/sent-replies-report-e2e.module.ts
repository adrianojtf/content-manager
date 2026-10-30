import { DynamicModule, Module } from '@nestjs/common';
import { ListSentRepliesReport } from '../../../src/application/social/list-sent-replies-report';
import { SentRepliesReportController } from '../../../src/presentation/http/sent-replies-report.controller';

@Module({})
class SentRepliesReportE2eModule {}

export function createSentRepliesReportE2eModule(
  listReport: Pick<ListSentRepliesReport, 'execute' | 'exportCsv'>,
): DynamicModule {
  return {
    module: SentRepliesReportE2eModule,
    controllers: [SentRepliesReportController],
    providers: [{ provide: ListSentRepliesReport, useValue: listReport }],
  };
}
