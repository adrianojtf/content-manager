import { DynamicModule, Module } from '@nestjs/common';
import {
  ApproveEpisodeSuggestionGroup,
  ConfirmEpisodeSetupSeasons,
  ConfirmEpisodeSetupSeries,
  DecideEpisodeSuggestions,
  GetEpisodeReview,
  RefreshEpisodeSuggestions,
} from '../../../src/application/analytics/episode-review.usecases';
import { EpisodeReviewController } from '../../../src/presentation/http/episode-review.controller';

@Module({})
class EpisodeReviewE2eModule {}

export function createEpisodeReviewE2eModule(useCases: {
  readonly refresh: Pick<RefreshEpisodeSuggestions, 'execute'>;
  readonly getReview: Pick<GetEpisodeReview, 'execute'>;
  readonly confirmSeries: Pick<ConfirmEpisodeSetupSeries, 'execute'>;
  readonly confirmSeasons: Pick<ConfirmEpisodeSetupSeasons, 'execute'>;
  readonly approve: Pick<ApproveEpisodeSuggestionGroup, 'execute'>;
  readonly decide: Pick<DecideEpisodeSuggestions, 'execute'>;
}): DynamicModule {
  return {
    module: EpisodeReviewE2eModule,
    controllers: [EpisodeReviewController],
    providers: [
      { provide: RefreshEpisodeSuggestions, useValue: useCases.refresh },
      { provide: GetEpisodeReview, useValue: useCases.getReview },
      { provide: ConfirmEpisodeSetupSeries, useValue: useCases.confirmSeries },
      { provide: ConfirmEpisodeSetupSeasons, useValue: useCases.confirmSeasons },
      { provide: ApproveEpisodeSuggestionGroup, useValue: useCases.approve },
      { provide: DecideEpisodeSuggestions, useValue: useCases.decide },
    ],
  };
}
