import { DynamicModule, Module } from '@nestjs/common';
import {
  CreateAnalyticsEpisode,
  CreateAnalyticsSeries,
  CreateManualAnalyticsEpisode,
  ListAvailableEpisodePublications,
  UpdateAnalyticsEpisodeEconomics,
  UpsertAnalyticsFollowerSnapshot,
  UpsertAnalyticsMonthlyRevenue,
  UpsertAnalyticsPerformanceObservation,
} from '../../../src/application/analytics/analytics-entry.usecases';
import { AnalyticsEntryController } from '../../../src/presentation/http/analytics-entry.controller';

@Module({})
class AnalyticsEntryE2eModule {}

export function createAnalyticsEntryE2eModule(useCases: {
  readonly createSeries: Pick<CreateAnalyticsSeries, 'execute'>;
  readonly createEpisode: Pick<CreateAnalyticsEpisode, 'execute'>;
  readonly createManualEpisode: Pick<CreateManualAnalyticsEpisode, 'execute'>;
  readonly listAvailableEpisodePublications: Pick<ListAvailableEpisodePublications, 'execute'>;
  readonly updateEconomics: Pick<UpdateAnalyticsEpisodeEconomics, 'execute'>;
  readonly upsertObservation: Pick<UpsertAnalyticsPerformanceObservation, 'execute'>;
  readonly upsertSnapshot: Pick<UpsertAnalyticsFollowerSnapshot, 'execute'>;
  readonly upsertRevenue: Pick<UpsertAnalyticsMonthlyRevenue, 'execute'>;
}): DynamicModule {
  return {
    module: AnalyticsEntryE2eModule,
    controllers: [AnalyticsEntryController],
    providers: [
      { provide: CreateAnalyticsSeries, useValue: useCases.createSeries },
      { provide: CreateAnalyticsEpisode, useValue: useCases.createEpisode },
      { provide: CreateManualAnalyticsEpisode, useValue: useCases.createManualEpisode },
      { provide: ListAvailableEpisodePublications, useValue: useCases.listAvailableEpisodePublications },
      { provide: UpdateAnalyticsEpisodeEconomics, useValue: useCases.updateEconomics },
      { provide: UpsertAnalyticsPerformanceObservation, useValue: useCases.upsertObservation },
      { provide: UpsertAnalyticsFollowerSnapshot, useValue: useCases.upsertSnapshot },
      { provide: UpsertAnalyticsMonthlyRevenue, useValue: useCases.upsertRevenue },
    ],
  };
}
