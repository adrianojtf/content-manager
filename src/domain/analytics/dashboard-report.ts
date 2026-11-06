export type DashboardMetricStatus = 'COMPLETE' | 'INCOMPLETE' | 'UNAVAILABLE';

export interface DashboardPublicationSource {
  readonly socialAccountId: string;
  readonly externalPublicationId: string;
  readonly platform: 'instagram' | 'facebook' | 'tiktok' | 'youtube';
  readonly publishedAt: string | null;
}

export interface DashboardSeriesSource {
  readonly id: string;
  readonly name: string;
}

export interface DashboardEpisodeSource {
  readonly id: string;
  readonly seriesId: string;
  readonly seasonNumber: number | null;
  readonly episodeNumber: number;
  readonly episodeCode: string;
  readonly productionCostAmount: string | null;
  readonly productionTimeSeconds: number | null;
  readonly publications: readonly DashboardPublicationSource[];
}

export interface DashboardObservationSource {
  readonly episodeId: string;
  readonly socialAccountId: string;
  readonly externalPublicationId: string;
  readonly platform: 'instagram' | 'facebook' | 'tiktok';
  readonly observedAt: string;
  readonly metrics: {
    readonly views: number | null;
    readonly likes: number | null;
    readonly comments: number | null;
    readonly shares: number | null;
    readonly saves: number | null;
    readonly followersGained: number | null;
  };
}

export interface DashboardFollowerSnapshotSource {
  readonly socialAccountId: string;
  readonly observedAt: string;
  readonly totalFollowers: number;
}

export interface DashboardRevenueSource {
  readonly platform: 'instagram' | 'facebook' | 'tiktok';
  readonly month: string;
  readonly amount: { readonly amount: string; readonly currency: 'BRL' };
}

export interface AnalyticsDashboardSourceData {
  readonly series: readonly DashboardSeriesSource[];
  readonly episodes: readonly DashboardEpisodeSource[];
  readonly observations: readonly DashboardObservationSource[];
  readonly socialAccountIds: readonly string[];
  readonly followerSnapshots: readonly DashboardFollowerSnapshotSource[];
  readonly revenue: readonly DashboardRevenueSource[];
}

interface DashboardMetric {
  readonly value: number | null;
  readonly status: DashboardMetricStatus;
}

interface DashboardWindowMetric extends DashboardMetric {
  readonly start: string;
  readonly end: string;
}

interface DashboardRankedEpisode extends DashboardMetric {
  readonly episodeId: string;
  readonly episodeCode: string;
  readonly seriesName: string;
  readonly seasonNumber: number | null;
  readonly episodeNumber: number;
}

interface DashboardRankedSeries extends DashboardMetric {
  readonly seriesId: string;
  readonly name: string;
  readonly episodeCount: number;
}

const dayMilliseconds = 24 * 60 * 60 * 1000;
const viewMilestones = [1_000_000, 3_000_000, 5_000_000, 10_000_000];
const revenueMilestones = [1_000, 3_000, 5_000, 10_000, 20_000, 50_000];
const platforms = ['tiktok', 'instagram', 'facebook'] as const;
const cumulativeMetrics = ['views', 'likes', 'comments', 'shares', 'saves', 'followersGained'] as const;
type CumulativeMetric = (typeof cumulativeMetrics)[number];

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function utcMonth(timestamp: number): string {
  return `${new Date(timestamp).toISOString().slice(0, 7)}-01`;
}

function addUtcMonths(month: string, amount: number): string {
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return utcMonth(date.getTime());
}

function isValidTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sourceKey(source: Pick<DashboardPublicationSource, 'socialAccountId' | 'externalPublicationId'>): string {
  return `${source.socialAccountId}\u0000${source.externalPublicationId}`;
}

function getDelta(
  data: AnalyticsDashboardSourceData,
  source: DashboardPublicationSource,
  metric: CumulativeMetric,
  start: number,
  end: number,
): DashboardMetric {
  const relevant = data.observations
    .filter((observation) => observation.socialAccountId === source.socialAccountId
      && observation.externalPublicationId === source.externalPublicationId
      && observation.platform === source.platform)
    .map((observation) => ({ observation, timestamp: isValidTimestamp(observation.observedAt) }))
    .filter((entry): entry is { observation: DashboardObservationSource; timestamp: number } => entry.timestamp !== null)
    .sort((left, right) => left.timestamp - right.timestamp);
  if (!relevant.length || relevant.every(({ observation }) => observation.metrics[metric] === null)) {
    return { value: null, status: 'UNAVAILABLE' };
  }
  const baseline = relevant.filter((entry) => entry.timestamp <= start).at(-1);
  const current = relevant.filter((entry) => entry.timestamp > start && entry.timestamp <= end).at(-1);
  const baselineValue = baseline?.observation.metrics[metric];
  const currentValue = current?.observation.metrics[metric];
  if (baselineValue === null || baselineValue === undefined
    || currentValue === null || currentValue === undefined
    || currentValue < baselineValue) {
    return { value: null, status: 'INCOMPLETE' };
  }
  return { value: currentValue - baselineValue, status: 'COMPLETE' };
}

function aggregateMetrics(metrics: readonly DashboardMetric[]): DashboardMetric {
  const complete = metrics.filter((metric) => metric.status === 'COMPLETE');
  if (complete.length === 0) {
    return {
      value: null,
      status: metrics.some((metric) => metric.status === 'INCOMPLETE') ? 'INCOMPLETE' : 'UNAVAILABLE',
    };
  }
  if (complete.length !== metrics.length) return { value: null, status: 'INCOMPLETE' };
  return { value: complete.reduce((total, metric) => total + (metric.value ?? 0), 0), status: 'COMPLETE' };
}

function periodMetric(
  data: AnalyticsDashboardSourceData,
  sources: readonly DashboardPublicationSource[],
  metric: CumulativeMetric,
  start: number,
  end: number,
): DashboardMetric {
  if (sources.length === 0) return { value: null, status: 'UNAVAILABLE' };
  return aggregateMetrics(sources.map((source) => getDelta(data, source, metric, start, end)));
}

function rankingView(
  data: AnalyticsDashboardSourceData,
  episodes: readonly DashboardEpisodeSource[],
  seriesById: ReadonlyMap<string, DashboardSeriesSource>,
  start: number,
  end: number,
): { readonly episodes: readonly DashboardRankedEpisode[]; readonly series: readonly DashboardRankedSeries[] } {
  const rankedEpisodes: DashboardRankedEpisode[] = [];
  const episodeViews = new Map<string, DashboardMetric>();
  for (const episode of episodes) {
    const metric = periodMetric(data, episode.publications.filter((publication) => publication.platform !== 'youtube'), 'views', start, end);
    episodeViews.set(episode.id, metric);
    if (metric.status === 'COMPLETE') {
      rankedEpisodes.push({
        episodeId: episode.id,
        episodeCode: episode.episodeCode,
        seriesName: seriesById.get(episode.seriesId)?.name ?? '',
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        ...metric,
      });
    }
  }

  const rankedSeries: DashboardRankedSeries[] = [];
  for (const series of seriesById.values()) {
    const seriesEpisodes = episodes.filter((episode) => episode.seriesId === series.id);
    const metrics = seriesEpisodes.map((episode) => episodeViews.get(episode.id) ?? { value: null, status: 'UNAVAILABLE' as const });
    const metric = aggregateMetrics(metrics);
    if (seriesEpisodes.length && metric.status === 'COMPLETE') {
      rankedSeries.push({
        seriesId: series.id,
        name: series.name,
        episodeCount: seriesEpisodes.length,
        ...metric,
      });
    }
  }
  const descending = (left: DashboardMetric, right: DashboardMetric) => (right.value ?? 0) - (left.value ?? 0);
  return {
    episodes: rankedEpisodes.sort(descending),
    series: rankedSeries.sort(descending),
  };
}

function growthPercent(current: DashboardMetric, previous: DashboardMetric): number | null {
  if (current.value === null || previous.value === null || previous.value === 0
    || current.status !== 'COMPLETE' || previous.status !== 'COMPLETE') return null;
  return ((current.value - previous.value) / previous.value) * 100;
}

function calculateRate(
  data: AnalyticsDashboardSourceData,
  sources: readonly DashboardPublicationSource[],
  start: number,
  end: number,
  numeratorMetrics: readonly CumulativeMetric[],
): DashboardMetric {
  const views = periodMetric(data, sources, 'views', start, end);
  const numeratorMetricsForPeriod = numeratorMetrics.map((metric) => (
    periodMetric(data, sources, metric, start, end)
  ));
  if (views.value === null || views.value === 0 || views.status !== 'COMPLETE'
    || numeratorMetricsForPeriod.some((metric) => metric.status !== 'COMPLETE' || metric.value === null)) {
    return {
      value: null,
      status: views.status === 'INCOMPLETE' || numeratorMetricsForPeriod.some((metric) => metric.status === 'INCOMPLETE')
        ? 'INCOMPLETE'
        : 'UNAVAILABLE',
    };
  }
  const numerator = numeratorMetricsForPeriod.reduce((total, metric) => total + (metric.value ?? 0), 0);
  return { value: (numerator / views.value) * 100, status: 'COMPLETE' };
}

function milestoneProgress(metric: DashboardMetric, milestones: readonly number[]) {
  const achieved = metric.value === null ? [] : milestones.filter((milestone) => metric.value! >= milestone);
  const next = metric.value === null ? milestones[0] : milestones.find((milestone) => milestone > metric.value! ) ?? null;
  const previous = achieved.at(-1) ?? 0;
  return {
    value: metric.value,
    status: metric.status,
    achieved,
    next,
    progressPercent: metric.value === null || next === null
      ? null
      : Math.max(0, Math.min(100, ((metric.value - previous) / (next - previous)) * 100)),
  };
}

function followerMetrics(
  data: AnalyticsDashboardSourceData,
  monthStart: number,
  end: number,
): { readonly total: DashboardMetric; readonly new: DashboardMetric } {
  if (data.socialAccountIds.length === 0) {
    return {
      total: { value: null, status: 'UNAVAILABLE' },
      new: { value: null, status: 'UNAVAILABLE' },
    };
  }
  const accountTotals: DashboardMetric[] = [];
  const accountDeltas: DashboardMetric[] = [];
  for (const accountId of data.socialAccountIds) {
    const snapshots = data.followerSnapshots
      .filter((snapshot) => snapshot.socialAccountId === accountId)
      .map((snapshot) => ({ snapshot, timestamp: isValidTimestamp(snapshot.observedAt) }))
      .filter((entry): entry is { snapshot: DashboardFollowerSnapshotSource; timestamp: number } => entry.timestamp !== null)
      .sort((left, right) => left.timestamp - right.timestamp);
    const current = snapshots.filter((entry) => entry.timestamp <= end).at(-1);
    if (!current) {
      accountTotals.push({ value: null, status: 'INCOMPLETE' });
      accountDeltas.push({ value: null, status: 'INCOMPLETE' });
      continue;
    }
    accountTotals.push({ value: current.snapshot.totalFollowers, status: 'COMPLETE' });
    const baseline = snapshots.filter((entry) => entry.timestamp <= monthStart).at(-1);
    if (!baseline || current.timestamp <= monthStart || current.snapshot.totalFollowers < baseline.snapshot.totalFollowers) {
      accountDeltas.push({ value: null, status: 'INCOMPLETE' });
    } else {
      accountDeltas.push({
        value: current.snapshot.totalFollowers - baseline.snapshot.totalFollowers,
        status: 'COMPLETE',
      });
    }
  }
  return { total: aggregateMetrics(accountTotals), new: aggregateMetrics(accountDeltas) };
}

function monthlyAmount(data: AnalyticsDashboardSourceData, month: string): DashboardMetric {
  const entries = data.revenue.filter((record) => record.month === month);
  if (entries.length === 0) return { value: null, status: 'UNAVAILABLE' };
  const cents = entries.reduce((total, entry) => total + Math.round(Number(entry.amount.amount) * 100), 0);
  return { value: cents / 100, status: 'COMPLETE' };
}

function monthlyProductionCost(data: AnalyticsDashboardSourceData, month: string): DashboardMetric {
  const episodes = data.episodes.filter((episode) => {
    const dates = episode.publications
      .map((publication) => publication.publishedAt)
      .filter((date): date is string => date !== null)
      .map(isValidTimestamp)
      .filter((timestamp): timestamp is number => timestamp !== null);
    return dates.length > 0 && utcMonth(Math.min(...dates)) === month;
  });
  const costs = episodes.map((episode) => episode.productionCostAmount);
  if (costs.length === 0 || costs.every((cost) => cost === null)) {
    return { value: null, status: 'UNAVAILABLE' };
  }
  if (costs.some((cost) => cost === null)) return { value: null, status: 'INCOMPLETE' };
  return {
    value: costs.reduce((total, cost) => total + Math.round(Number(cost) * 100), 0) / 100,
    status: 'COMPLETE',
  };
}

export function buildAnalyticsDashboardReport(
  data: AnalyticsDashboardSourceData,
  now: number = Date.now(),
) {
  const generatedAt = utcDate(now);
  const seriesById = new Map(data.series.map((series) => [series.id, series]));
  const episodes = data.episodes;
  const platformSources = (platform: (typeof platforms)[number]) => episodes.flatMap((episode) => (
    episode.publications.filter((publication) => publication.platform === platform)
  ));
  const range = (days: number) => {
    const start = now - days * dayMilliseconds;
    return {
      start,
      end: now,
      views: {
        ...periodMetric(
          data,
          episodes.flatMap((episode) => episode.publications.filter((publication) => publication.platform !== 'youtube')),
          'views',
          start,
          now,
        ),
        start: utcDate(start),
        end: generatedAt,
      },
      rankings: rankingView(data, episodes, seriesById, start, now),
    };
  };
  const sevenDays = range(7);
  const thirtyDays = range(30);
  const ninetyDays = range(90);
  const currentMonth = utcMonth(now);
  const previousMonth = addUtcMonths(currentMonth, -1);
  const monthStart = Date.parse(`${currentMonth}T00:00:00.000Z`);
  const previousMonthStart = Date.parse(`${previousMonth}T00:00:00.000Z`);
  const dayOfMonth = new Date(now).getUTCDate();
  const previousMonthDays = new Date(Date.parse(`${currentMonth}T00:00:00.000Z`) - 1).getUTCDate();
  const previousComparableEnd = Math.min(dayOfMonth, previousMonthDays);
  const previousComparableTimestamp = previousMonthStart + previousComparableEnd * dayMilliseconds - 1;
  const monthViews = periodMetric(
    data,
    episodes.flatMap((episode) => episode.publications.filter((publication) => publication.platform !== 'youtube')),
    'views',
    monthStart,
    now,
  );
  const previousMonthViews = periodMetric(
    data,
    episodes.flatMap((episode) => episode.publications.filter((publication) => publication.platform !== 'youtube')),
    'views',
    previousMonthStart,
    previousComparableTimestamp,
  );
  const followers = followerMetrics(data, monthStart, now);
  const conversion = (() => {
    const viewCount = periodMetric(
      data,
      episodes.flatMap((episode) => episode.publications.filter((publication) => publication.platform !== 'youtube')),
      'views',
      monthStart,
      now,
    );
    const followerCount = periodMetric(
      data,
      episodes.flatMap((episode) => episode.publications.filter((publication) => publication.platform !== 'youtube')),
      'followersGained',
      monthStart,
      now,
    );
    return viewCount.value === null || viewCount.value === 0 || followerCount.value === null
      || viewCount.status !== 'COMPLETE' || followerCount.status !== 'COMPLETE'
      ? { value: null, status: viewCount.status === 'INCOMPLETE' || followerCount.status === 'INCOMPLETE' ? 'INCOMPLETE' as const : 'UNAVAILABLE' as const }
      : { value: (followerCount.value / viewCount.value) * 100, status: 'COMPLETE' as const };
  })();
  const revenueMetric = monthlyAmount(data, currentMonth);
  const costMetric = monthlyProductionCost(data, currentMonth);
  const platformReports = platforms.map((platform) => {
    const sources = platformSources(platform);
    const currentViews = periodMetric(data, sources, 'views', monthStart, now);
    const previousViews = periodMetric(data, sources, 'views', previousMonthStart, previousComparableTimestamp);
    const rankingWindows = [
      { days: 7, start: sevenDays.start },
      { days: 30, start: thirtyDays.start },
      { days: 90, start: ninetyDays.start },
    ];
    return {
      platform,
      views: {
        last7Days: periodMetric(data, sources, 'views', sevenDays.start, now),
        last30Days: periodMetric(data, sources, 'views', thirtyDays.start, now),
        last90Days: periodMetric(data, sources, 'views', ninetyDays.start, now),
      },
      monthGrowthPercent: growthPercent(currentViews, previousViews),
      monthViews: currentViews,
      rates: Object.fromEntries(rankingWindows.map(({ days, start }) => [days, {
        engagement: calculateRate(data, sources, start, now, ['likes', 'comments', 'shares', 'saves']),
        share: calculateRate(data, sources, start, now, ['shares']),
        conversion: calculateRate(data, sources, start, now, ['followersGained']),
      }])),
    };
  });
  const monthlyRevenueTotal = revenueMetric;
  return {
    generatedAt,
    reportingTimezone: 'UTC',
    month: {
      start: currentMonth,
      views: monthViews,
      previousComparableViews: previousMonthViews,
      growthPercent: growthPercent(monthViews, previousMonthViews),
      revenue: revenueMetric,
      productionCost: costMetric,
    },
    views: {
      last7Days: sevenDays.views,
      last30Days: thirtyDays.views,
      last90Days: ninetyDays.views,
    },
    followers,
    conversion,
    platforms: platformReports,
    rankings: {
      last7Days: sevenDays.rankings,
      last30Days: thirtyDays.rankings,
      last90Days: ninetyDays.rankings,
      defaultWindowDays: 30,
    },
    goals: {
      views: milestoneProgress(monthViews, viewMilestones),
      revenue: milestoneProgress(monthlyRevenueTotal, revenueMilestones),
    },
    seriesCount: data.series.length,
    episodeCount: data.episodes.length,
    linkedPublicationCount: data.episodes.reduce(
      (total, episode) => total + episode.publications.length,
      0,
    ),
  };
}
