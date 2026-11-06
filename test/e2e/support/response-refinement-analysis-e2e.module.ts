import { DynamicModule, Module } from '@nestjs/common';
import { ResponseRefinementAnalysisController } from '../../../src/presentation/http/response-refinement-analysis.controller';
import { AnalyzeResponseRefinementPairs } from '../../../src/application/social/analyze-response-refinement-pairs';

@Module({})
export class ResponseRefinementAnalysisE2eModule {
  static register(analyze: AnalyzeResponseRefinementPairs): DynamicModule {
    return {
      module: ResponseRefinementAnalysisE2eModule,
      controllers: [ResponseRefinementAnalysisController],
      providers: [{ provide: AnalyzeResponseRefinementPairs, useValue: analyze }],
    };
  }
}
