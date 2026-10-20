import { DynamicModule, Module } from '@nestjs/common';
import { EvaluateComment, GenerateCommentResponseSuggestion } from '../../../src/application/social/comment-intelligence.usecases';
import { CommentIntelligenceController } from '../../../src/presentation/http/comment-intelligence.controller';

@Module({})
class CommentIntelligenceE2eModule {}

export function createCommentIntelligenceE2eModule(options: {
  readonly evaluate: Pick<EvaluateComment, 'execute'>;
  readonly generate: Pick<GenerateCommentResponseSuggestion, 'execute'>;
}): DynamicModule {
  return {
    module: CommentIntelligenceE2eModule,
    controllers: [CommentIntelligenceController],
    providers: [
      { provide: EvaluateComment, useValue: options.evaluate },
      { provide: GenerateCommentResponseSuggestion, useValue: options.generate },
    ],
  };
}
