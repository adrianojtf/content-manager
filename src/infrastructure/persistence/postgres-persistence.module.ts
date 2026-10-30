import { DynamicModule, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool, PoolConfig } from 'pg';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';
import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { SocialAccountRepository } from '../../application/ports/social-account-repository.port';
import type { SocialAccountDisconnector } from '../../application/ports/social-account-disconnector.port';
import type { SocialPublicationReader } from '../../application/ports/social-publication-reader.port';
import type { SocialPublicationRepository } from '../../application/ports/social-publication-repository.port';
import type { SocialCommentLiker, SocialCommentReader, SocialCommentResponder, SocialCommentResponderRegistry } from '../../application/ports/social-comment.port';
import type { SocialCommentRepository } from '../../application/ports/social-comment-repository.port';
import type { SentReplyReportRepository } from '../../application/ports/sent-reply-report.repository.port';
import type { EpisodeReviewRepository } from '../../application/ports/episode-review.repository.port';
import type { AnalyticsEntryRepository } from '../../application/ports/analytics-entry.repository.port';
import type { CommentWorkflowEventRepository } from '../../application/ports/comment-workflow-event-repository.port';
import type { ResponseRefinementPairRepository } from '../../application/ports/response-refinement-pair-repository.port';
import type { CommentEvaluator } from '../../application/ports/comment-evaluator.port';
import type { ResponseEvaluator } from '../../application/ports/response-evaluator.port';
import type { ResponseSuggestionGenerator } from '../../application/ports/response-suggestion-generator.port';
import type { ResponseGenerationSettingsRepository } from '../../application/ports/response-generation-settings.repository.port';
import type { AIProviderSettingsRepository } from '../../application/ports/ai-provider-settings.repository.port';
import type { ResponseToneSettingsRepository, TenantResponseToneSettingsRepository } from '../../application/ports/response-tone-settings.repository.port';
import type { TenantVerifiedReleaseScheduleRepository, VerifiedReleaseScheduleRepository } from '../../application/ports/verified-release-schedule.repository.port';
import type { BatchOperationIdGenerator } from '../../application/ports/batch-operation-id-generator.port';
import type { ManualReplyAttemptIdGenerator } from '../../application/ports/manual-reply-attempt-id-generator.port';
import type { YouTubeAccountCredentialProvider, YouTubeAccessTokenRefresher } from '../../application/ports/youtube-account-credential-provider.port';
import type { YouTubeOAuthFlowStateStore, YouTubeOAuthProvider } from '../../application/ports/youtube-oauth.port';
import type { InstagramOAuthFlowStateStore, InstagramOAuthProvider } from '../../application/ports/instagram-oauth.port';
import type { FacebookOAuthFlowStateStore, FacebookOAuthProvider } from '../../application/ports/facebook-oauth.port';
import type { TikTokBusinessOAuthFlowStateStore, TikTokBusinessOAuthProvider } from '../../application/ports/tiktok-business-oauth.port';
import { BeginYouTubeOAuth } from '../../application/social/begin-youtube-oauth';
import { CompleteYouTubeOAuth } from '../../application/social/complete-youtube-oauth';
import { BeginInstagramOAuth } from '../../application/social/begin-instagram-oauth';
import { CompleteInstagramOAuth } from '../../application/social/complete-instagram-oauth';
import { BeginFacebookOAuth } from '../../application/social/begin-facebook-oauth';
import { CompleteFacebookOAuth } from '../../application/social/complete-facebook-oauth';
import { SelectFacebookPage } from '../../application/social/select-facebook-page';
import { BeginTikTokBusinessOAuth } from '../../application/social/begin-tiktok-business-oauth';
import { CompleteTikTokBusinessOAuth } from '../../application/social/complete-tiktok-business-oauth';
import { ConnectSocialAccount } from '../../application/social/connect-social-account';
import { ListConnectedSocialAccounts } from '../../application/social/list-connected-social-accounts';
import { DisconnectSocialAccount } from '../../application/social/disconnect-social-account';
import { ListSocialPublications, type SocialPublicationReaderRegistry } from '../../application/social/list-social-publications';
import { ListPublicationComments, SyncPublicationComments, type SocialCommentReaderRegistry } from '../../application/social/sync-publication-comments';
import { GetCommentSummary } from '../../application/social/comment-summary';
import { ListSentRepliesReport } from '../../application/social/list-sent-replies-report';
import {
  ApproveEpisodeSuggestionGroup,
  ConfirmEpisodeSetupSeasons,
  ConfirmEpisodeSetupSeries,
  DecideEpisodeSuggestions,
  GetEpisodeReview,
  RefreshEpisodeSuggestions,
} from '../../application/analytics/episode-review.usecases';
import {
  CreateAnalyticsEpisode,
  CreateAnalyticsSeries,
  CreateManualAnalyticsEpisode,
  ListAvailableEpisodePublications,
  UpdateAnalyticsEpisodeEconomics,
  UpsertAnalyticsFollowerSnapshot,
  UpsertAnalyticsMonthlyRevenue,
  UpsertAnalyticsPerformanceObservation,
} from '../../application/analytics/analytics-entry.usecases';
import { SetCommentLike } from '../../application/social/set-comment-like';
import { EvaluateComment, EvaluateResponseSuggestion, GenerateCommentResponseSuggestion } from '../../application/social/comment-intelligence.usecases';
import { SendManualCommentReply } from '../../application/social/send-manual-comment-reply';
import { RecordResponseRefinementPair } from '../../application/social/record-response-refinement-pair';
import { ListCommentWorkflowBatchEvents, RunCommentWorkflowBatch } from '../../application/social/run-comment-workflow-batch';
import { ConfiguredResponseSuggestionGenerator, GetResponseGenerationSettings, UpdateResponseGenerationSettings } from '../../application/social/response-generation-settings';
import { GetAccountResponseToneSettings, GetTenantResponseToneSettings, UpdateAccountResponseToneSettings, UpdateTenantResponseToneSettings } from '../../application/social/response-tone-settings';
import { GetTenantVerifiedReleaseSchedule, GetVerifiedReleaseSchedule, UpdateTenantVerifiedReleaseSchedule, UpdateVerifiedReleaseSchedule } from '../../application/social/verified-release-schedule';
import {
  CorrectCommentAnalysis,
  ListCommentWorkflow,
  RecordCommentAnalysis,
  RecordResponseSuggestion,
  ReviseResponseSuggestion,
  RecordResponseEvaluation,
  RecordManualResponse,
  ReviseManualResponse,
} from '../../application/social/comment-workflow-audit';
import { LocalPilotTenantContext } from './local-pilot-tenant-context';
import { PostgresSocialAccountRepository } from './postgres-social-account.repository';
import { PostgresSocialAccountDisconnector } from './postgres-social-account-disconnector';
import { PostgresSocialPublicationRepository } from './postgres-social-publication.repository';
import { PostgresSocialCredentialVault } from './postgres-social-credential-vault';
import { PostgresSocialCommentRepository } from './postgres-social-comment.repository';
import { PostgresSentReplyReportRepository } from './postgres-sent-reply-report.repository';
import { PostgresEpisodeReviewRepository } from './postgres-episode-review.repository';
import { PostgresAnalyticsEntryRepository } from './postgres-analytics-entry.repository';
import { PostgresCommentWorkflowEventRepository } from './postgres-comment-workflow-event.repository';
import { PostgresResponseRefinementPairRepository } from './postgres-response-refinement-pair.repository';
import { PostgresResponseGenerationSettingsRepository } from './postgres-response-generation-settings.repository';
import { PostgresAIProviderSettingsRepository } from './postgres-ai-provider-settings.repository';
import { PostgresSocialAccountResponseToneSettingsRepository } from './postgres-social-account-response-tone-settings.repository';
import { PostgresTenantResponseToneSettingsRepository } from './postgres-tenant-response-tone-settings.repository';
import { PostgresVerifiedReleaseScheduleRepository } from './postgres-verified-release-schedule.repository';
import { PostgresTenantVerifiedReleaseScheduleRepository } from './postgres-tenant-verified-release-schedule.repository';
import { UuidSocialAccountIdGenerator } from './uuid-social-account-id-generator';
import { UuidBatchOperationIdGenerator } from './uuid-batch-operation-id-generator';
import { UuidManualReplyAttemptIdGenerator } from './uuid-manual-reply-attempt-id-generator';
import { InMemoryYouTubeOAuthFlowStateStore } from '../social/in-memory-youtube-oauth-flow-state-store';
import { InMemoryInstagramOAuthFlowStateStore } from '../social/in-memory-instagram-oauth-flow-state-store';
import { InMemoryFacebookOAuthFlowStateStore } from '../social/in-memory-facebook-oauth-flow-state-store';
import { InMemoryFacebookPageSelectionStore } from '../social/in-memory-facebook-page-selection-store';
import { InMemoryTikTokBusinessOAuthFlowStateStore } from '../social/in-memory-tiktok-business-oauth-flow-state-store';
import { YouTubeAccountCredentialResolver } from '../social/youtube-account-credential-resolver';
import { InstagramAccountCredentialResolver } from '../social/instagram-account-credential-resolver';
import { InstagramOAuthClient } from '../social/instagram-oauth-client';
import { FacebookOAuthClient } from '../social/facebook-oauth-client';
import { TikTokBusinessOAuthClient } from '../social/tiktok-business-oauth-client';
import { TikTokAccountCredentialResolver } from '../social/tiktok-account-credential-resolver';
import { YouTubeCommunityAdapter } from '../social/youtube-community.adapter';
import { TikTokBusinessCommunityAdapter } from '../social/tiktok-business-community.adapter';
import { InstagramCommunityAdapter } from '../social/instagram-community.adapter';
import { FacebookPagesCommunityAdapter } from '../social/facebook-pages-community.adapter';
import { PlatformSocialCommentResponder } from '../social/platform-social-comment-responder';
import { PlatformSocialCommentLiker } from '../social/platform-social-comment-liker';
import { YouTubeOAuthClient } from '../social/youtube-oauth-client';
import { YouTubePublicationReader } from '../social/youtube-publication-reader';
import { TikTokBusinessPublicationReader } from '../social/tiktok-business-publication-reader';
import { GetAIProviderAccessStatus, UpdateAIProviderAccessSettings } from '../../application/social/ai-provider-access-settings';
import { InstagramPublicationReader } from '../social/instagram-publication-reader';
import { FacebookPagesPublicationReader } from '../social/facebook-pages-publication-reader';
import { JevCommentEvaluator } from '../intelligence/jev-comment-evaluator';
import { JevResponseEvaluator } from '../intelligence/jev-response-evaluator';
import { JevPublicationEpisodeClassifier } from '../intelligence/jev-publication-episode-classifier';
import { TypeSafeSystemOneClient } from '../intelligence/typesafe-system-one.client';
import { GeminiFlashLiteResponseSuggestionGenerator } from '../intelligence/gemini-flash-lite-response-suggestion-generator';
import { OpenAIGpt6LunaResponseSuggestionGenerator } from '../intelligence/openai-gpt-6-luna-response-suggestion-generator';
import { JsonLocalizationAdapter } from '../localization/json-localization.adapter';
import { createPostgresPool, PostgresPersistenceAdapter } from './postgres-persistence.adapter';

const POSTGRES_POOL = Symbol('POSTGRES_POOL');
export const RELATIONAL_DATABASE = Symbol('RELATIONAL_DATABASE');
export const SOCIAL_ACCOUNT_REPOSITORY = Symbol('SOCIAL_ACCOUNT_REPOSITORY');
export const SOCIAL_ACCOUNT_DISCONNECTOR = Symbol('SOCIAL_ACCOUNT_DISCONNECTOR');
export const SOCIAL_PUBLICATION_REPOSITORY = Symbol('SOCIAL_PUBLICATION_REPOSITORY');
export const EPISODE_REVIEW_REPOSITORY = Symbol('EPISODE_REVIEW_REPOSITORY');
export const ANALYTICS_ENTRY_REPOSITORY = Symbol('ANALYTICS_ENTRY_REPOSITORY');
export const SOCIAL_CREDENTIAL_VAULT = Symbol('SOCIAL_CREDENTIAL_VAULT');
export const SOCIAL_PUBLICATION_READERS = Symbol('SOCIAL_PUBLICATION_READERS');
export const YOUTUBE_ACCOUNT_CREDENTIAL_PROVIDER = Symbol('YOUTUBE_ACCOUNT_CREDENTIAL_PROVIDER');
export const SOCIAL_COMMENT_READER = Symbol('SOCIAL_COMMENT_READER');
export const SOCIAL_COMMENT_RESPONDER = Symbol('SOCIAL_COMMENT_RESPONDER');
export const SOCIAL_COMMENT_LIKER = Symbol('SOCIAL_COMMENT_LIKER');
export const SOCIAL_COMMENT_REPOSITORY = Symbol('SOCIAL_COMMENT_REPOSITORY');
export const SENT_REPLY_REPORT_REPOSITORY = Symbol('SENT_REPLY_REPORT_REPOSITORY');
export const SOCIAL_COMMENT_READERS = Symbol('SOCIAL_COMMENT_READERS');
export const COMMENT_WORKFLOW_EVENT_REPOSITORY = Symbol('COMMENT_WORKFLOW_EVENT_REPOSITORY');
export const RESPONSE_REFINEMENT_PAIR_REPOSITORY = Symbol('RESPONSE_REFINEMENT_PAIR_REPOSITORY');
export const COMMENT_EVALUATOR = Symbol('COMMENT_EVALUATOR');
export const RESPONSE_EVALUATOR = Symbol('RESPONSE_EVALUATOR');
export const RESPONSE_SUGGESTION_GENERATOR = Symbol('RESPONSE_SUGGESTION_GENERATOR');
export const RESPONSE_GENERATION_SETTINGS_REPOSITORY = Symbol('RESPONSE_GENERATION_SETTINGS_REPOSITORY');
export const AI_PROVIDER_SETTINGS_REPOSITORY = Symbol('AI_PROVIDER_SETTINGS_REPOSITORY');
export const RESPONSE_TONE_SETTINGS_REPOSITORY = Symbol('RESPONSE_TONE_SETTINGS_REPOSITORY');
export const TENANT_RESPONSE_TONE_SETTINGS_REPOSITORY = Symbol('TENANT_RESPONSE_TONE_SETTINGS_REPOSITORY');
export const VERIFIED_RELEASE_SCHEDULE_REPOSITORY = Symbol('VERIFIED_RELEASE_SCHEDULE_REPOSITORY');
export const TENANT_VERIFIED_RELEASE_SCHEDULE_REPOSITORY = Symbol('TENANT_VERIFIED_RELEASE_SCHEDULE_REPOSITORY');
const YOUTUBE_COMMUNITY_ADAPTER = Symbol('YOUTUBE_COMMUNITY_ADAPTER');

@Injectable()
export class PostgresConnection implements OnModuleInit, OnModuleDestroy {
  readonly database: RelationalDatabase;
  private closed = false;

  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {
    this.database = new PostgresPersistenceAdapter(pool);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
    } catch (error) {
      await this.closePool();
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.closePool();
  }

  private async closePool(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pool.end();
  }
}

@Module({})
export class PostgresPersistenceModule {
  static register(config: PoolConfig): DynamicModule {
    return {
      module: PostgresPersistenceModule,
      providers: [
        { provide: POSTGRES_POOL, useFactory: () => createPostgresPool(config) },
        PostgresConnection,
        LocalPilotTenantContext,
        UuidSocialAccountIdGenerator,
        UuidBatchOperationIdGenerator,
        UuidManualReplyAttemptIdGenerator,
        {
          provide: RELATIONAL_DATABASE,
          useFactory: (connection: PostgresConnection) => connection.database,
          inject: [PostgresConnection],
        },
        {
          provide: SOCIAL_ACCOUNT_REPOSITORY,
          useFactory: (database: RelationalDatabase): SocialAccountRepository => new PostgresSocialAccountRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: SOCIAL_ACCOUNT_DISCONNECTOR,
          useFactory: (database: RelationalDatabase): SocialAccountDisconnector => new PostgresSocialAccountDisconnector(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: SOCIAL_PUBLICATION_REPOSITORY,
          useFactory: (database: RelationalDatabase): SocialPublicationRepository => new PostgresSocialPublicationRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: EPISODE_REVIEW_REPOSITORY,
          useFactory: (database: RelationalDatabase): EpisodeReviewRepository => new PostgresEpisodeReviewRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: ANALYTICS_ENTRY_REPOSITORY,
          useFactory: (database: RelationalDatabase): AnalyticsEntryRepository => new PostgresAnalyticsEntryRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        { provide: JsonLocalizationAdapter, useFactory: () => new JsonLocalizationAdapter() },
        {
          provide: JevPublicationEpisodeClassifier,
          useFactory: (client: TypeSafeSystemOneClient) => new JevPublicationEpisodeClassifier(client),
          inject: [TypeSafeSystemOneClient],
        },
        {
          provide: SOCIAL_COMMENT_REPOSITORY,
          useFactory: (database: RelationalDatabase): SocialCommentRepository => new PostgresSocialCommentRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: SENT_REPLY_REPORT_REPOSITORY,
          useFactory: (database: RelationalDatabase): SentReplyReportRepository => new PostgresSentReplyReportRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: COMMENT_WORKFLOW_EVENT_REPOSITORY,
          useFactory: (database: RelationalDatabase): CommentWorkflowEventRepository => new PostgresCommentWorkflowEventRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: RESPONSE_REFINEMENT_PAIR_REPOSITORY,
          useFactory: (database: RelationalDatabase): ResponseRefinementPairRepository => new PostgresResponseRefinementPairRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: RecordResponseRefinementPair,
          useFactory: (pairs: ResponseRefinementPairRepository) => new RecordResponseRefinementPair(pairs),
          inject: [RESPONSE_REFINEMENT_PAIR_REPOSITORY],
        },
        {
          provide: RESPONSE_GENERATION_SETTINGS_REPOSITORY,
          useFactory: (database: RelationalDatabase): ResponseGenerationSettingsRepository => new PostgresResponseGenerationSettingsRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: AI_PROVIDER_SETTINGS_REPOSITORY,
          useFactory: (database: RelationalDatabase): AIProviderSettingsRepository => new PostgresAIProviderSettingsRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: TypeSafeSystemOneClient,
          useFactory: (settings: AIProviderSettingsRepository) => new TypeSafeSystemOneClient(process.env, fetch, settings),
          inject: [AI_PROVIDER_SETTINGS_REPOSITORY],
        },
        {
          provide: RESPONSE_TONE_SETTINGS_REPOSITORY,
          useFactory: (database: RelationalDatabase): ResponseToneSettingsRepository => new PostgresSocialAccountResponseToneSettingsRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: TENANT_RESPONSE_TONE_SETTINGS_REPOSITORY,
          useFactory: (database: RelationalDatabase): TenantResponseToneSettingsRepository => new PostgresTenantResponseToneSettingsRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: VERIFIED_RELEASE_SCHEDULE_REPOSITORY,
          useFactory: (database: RelationalDatabase): VerifiedReleaseScheduleRepository => new PostgresVerifiedReleaseScheduleRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: TENANT_VERIFIED_RELEASE_SCHEDULE_REPOSITORY,
          useFactory: (database: RelationalDatabase): TenantVerifiedReleaseScheduleRepository => new PostgresTenantVerifiedReleaseScheduleRepository(database),
          inject: [RELATIONAL_DATABASE],
        },
        {
          provide: GeminiFlashLiteResponseSuggestionGenerator,
          useFactory: (settings: AIProviderSettingsRepository) => new GeminiFlashLiteResponseSuggestionGenerator(process.env, fetch, settings),
          inject: [AI_PROVIDER_SETTINGS_REPOSITORY],
        },
        {
          provide: OpenAIGpt6LunaResponseSuggestionGenerator,
          useFactory: (settings: AIProviderSettingsRepository) => new OpenAIGpt6LunaResponseSuggestionGenerator(process.env, fetch, settings),
          inject: [AI_PROVIDER_SETTINGS_REPOSITORY],
        },
        {
          provide: RESPONSE_SUGGESTION_GENERATOR,
          useFactory: (settings: ResponseGenerationSettingsRepository, google: ResponseSuggestionGenerator, openai: ResponseSuggestionGenerator) => new ConfiguredResponseSuggestionGenerator(settings, { google, openai }),
          inject: [RESPONSE_GENERATION_SETTINGS_REPOSITORY, GeminiFlashLiteResponseSuggestionGenerator, OpenAIGpt6LunaResponseSuggestionGenerator],
        },
        {
          provide: GetResponseGenerationSettings,
          useFactory: (settings: ResponseGenerationSettingsRepository) => new GetResponseGenerationSettings(settings),
          inject: [RESPONSE_GENERATION_SETTINGS_REPOSITORY],
        },
        {
          provide: UpdateResponseGenerationSettings,
          useFactory: (settings: ResponseGenerationSettingsRepository) => new UpdateResponseGenerationSettings(settings),
          inject: [RESPONSE_GENERATION_SETTINGS_REPOSITORY],
        },
        {
          provide: GetAIProviderAccessStatus,
          useFactory: (settings: AIProviderSettingsRepository) => new GetAIProviderAccessStatus(settings),
          inject: [AI_PROVIDER_SETTINGS_REPOSITORY],
        },
        {
          provide: UpdateAIProviderAccessSettings,
          useFactory: (settings: AIProviderSettingsRepository) => new UpdateAIProviderAccessSettings(settings),
          inject: [AI_PROVIDER_SETTINGS_REPOSITORY],
        },
        {
          provide: GetAccountResponseToneSettings,
          useFactory: (accounts: SocialAccountRepository, settings: ResponseToneSettingsRepository, tenantSettings: TenantResponseToneSettingsRepository, tenant: LocalPilotTenantContext) => new GetAccountResponseToneSettings(accounts, settings, tenantSettings, tenant),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, RESPONSE_TONE_SETTINGS_REPOSITORY, TENANT_RESPONSE_TONE_SETTINGS_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: UpdateAccountResponseToneSettings,
          useFactory: (accounts: SocialAccountRepository, settings: ResponseToneSettingsRepository, tenant: LocalPilotTenantContext) => new UpdateAccountResponseToneSettings(accounts, settings, tenant),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, RESPONSE_TONE_SETTINGS_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: GetTenantResponseToneSettings,
          useFactory: (tenantSettings: TenantResponseToneSettingsRepository, tenant: LocalPilotTenantContext) => new GetTenantResponseToneSettings(tenantSettings, tenant),
          inject: [TENANT_RESPONSE_TONE_SETTINGS_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: UpdateTenantResponseToneSettings,
          useFactory: (tenantSettings: TenantResponseToneSettingsRepository, tenant: LocalPilotTenantContext) => new UpdateTenantResponseToneSettings(tenantSettings, tenant),
          inject: [TENANT_RESPONSE_TONE_SETTINGS_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: GetVerifiedReleaseSchedule,
          useFactory: (accounts: SocialAccountRepository, schedules: VerifiedReleaseScheduleRepository, tenantSchedules: TenantVerifiedReleaseScheduleRepository, tenant: LocalPilotTenantContext) => new GetVerifiedReleaseSchedule(accounts, schedules, tenantSchedules, tenant),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, VERIFIED_RELEASE_SCHEDULE_REPOSITORY, TENANT_VERIFIED_RELEASE_SCHEDULE_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: UpdateVerifiedReleaseSchedule,
          useFactory: (accounts: SocialAccountRepository, schedules: VerifiedReleaseScheduleRepository, tenant: LocalPilotTenantContext) => new UpdateVerifiedReleaseSchedule(accounts, schedules, tenant),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, VERIFIED_RELEASE_SCHEDULE_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: GetTenantVerifiedReleaseSchedule,
          useFactory: (tenantSchedules: TenantVerifiedReleaseScheduleRepository, tenant: LocalPilotTenantContext) => new GetTenantVerifiedReleaseSchedule(tenantSchedules, tenant),
          inject: [TENANT_VERIFIED_RELEASE_SCHEDULE_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: UpdateTenantVerifiedReleaseSchedule,
          useFactory: (tenantSchedules: TenantVerifiedReleaseScheduleRepository, tenant: LocalPilotTenantContext) => new UpdateTenantVerifiedReleaseSchedule(tenantSchedules, tenant),
          inject: [TENANT_VERIFIED_RELEASE_SCHEDULE_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: COMMENT_EVALUATOR,
          useFactory: (client: TypeSafeSystemOneClient): CommentEvaluator => new JevCommentEvaluator(client),
          inject: [TypeSafeSystemOneClient],
        },
        {
          provide: RESPONSE_EVALUATOR,
          useFactory: (client: TypeSafeSystemOneClient): ResponseEvaluator => new JevResponseEvaluator(client),
          inject: [TypeSafeSystemOneClient],
        },
        {
          provide: SOCIAL_CREDENTIAL_VAULT,
          useFactory: (database: RelationalDatabase): SocialCredentialVault => new PostgresSocialCredentialVault(database),
          inject: [RELATIONAL_DATABASE],
        },
        InMemoryYouTubeOAuthFlowStateStore,
        { provide: InMemoryInstagramOAuthFlowStateStore, useFactory: () => new InMemoryInstagramOAuthFlowStateStore() },
        { provide: InMemoryFacebookOAuthFlowStateStore, useFactory: () => new InMemoryFacebookOAuthFlowStateStore() },
        { provide: InMemoryFacebookPageSelectionStore, useFactory: () => new InMemoryFacebookPageSelectionStore() },
        { provide: InMemoryTikTokBusinessOAuthFlowStateStore, useFactory: () => new InMemoryTikTokBusinessOAuthFlowStateStore() },
        {
          provide: InstagramOAuthClient,
          useFactory: (credentials: SocialCredentialVault): InstagramOAuthClient => new InstagramOAuthClient(credentials),
          inject: [SOCIAL_CREDENTIAL_VAULT],
        },
        {
          provide: FacebookOAuthClient,
          useFactory: (credentials: SocialCredentialVault, selections: InMemoryFacebookPageSelectionStore): FacebookOAuthClient => new FacebookOAuthClient(credentials, process.env, fetch, Date.now, selections),
          inject: [SOCIAL_CREDENTIAL_VAULT, InMemoryFacebookPageSelectionStore],
        },
        {
          provide: TikTokBusinessOAuthClient,
          useFactory: (credentials: SocialCredentialVault): TikTokBusinessOAuthClient => new TikTokBusinessOAuthClient(credentials),
          inject: [SOCIAL_CREDENTIAL_VAULT],
        },
        {
          provide: TikTokAccountCredentialResolver,
          useFactory: (credentials: SocialCredentialVault, refresher: TikTokBusinessOAuthClient): TikTokAccountCredentialResolver => new TikTokAccountCredentialResolver(credentials, refresher),
          inject: [SOCIAL_CREDENTIAL_VAULT, TikTokBusinessOAuthClient],
        },
        {
          provide: InstagramAccountCredentialResolver,
          useFactory: (credentials: SocialCredentialVault, refresher: InstagramOAuthClient): InstagramAccountCredentialResolver => new InstagramAccountCredentialResolver(credentials, refresher),
          inject: [SOCIAL_CREDENTIAL_VAULT, InstagramOAuthClient],
        },
        {
          provide: YouTubeOAuthClient,
          useFactory: (credentials: SocialCredentialVault): YouTubeOAuthClient => new YouTubeOAuthClient(credentials),
          inject: [SOCIAL_CREDENTIAL_VAULT],
        },
        {
          provide: YOUTUBE_ACCOUNT_CREDENTIAL_PROVIDER,
          useFactory: (credentials: SocialCredentialVault, refresher: YouTubeAccessTokenRefresher): YouTubeAccountCredentialProvider => new YouTubeAccountCredentialResolver(credentials, refresher),
          inject: [SOCIAL_CREDENTIAL_VAULT, YouTubeOAuthClient],
        },
        {
          provide: YouTubePublicationReader,
          useFactory: (credentials: YouTubeAccountCredentialProvider) => new YouTubePublicationReader(credentials),
          inject: [YOUTUBE_ACCOUNT_CREDENTIAL_PROVIDER],
        },
        {
          provide: TikTokBusinessPublicationReader,
          useFactory: (credentials: SocialCredentialVault, tokens: TikTokAccountCredentialResolver) => new TikTokBusinessPublicationReader(credentials, fetch, tokens),
          inject: [SOCIAL_CREDENTIAL_VAULT, TikTokAccountCredentialResolver],
        },
        {
          provide: InstagramPublicationReader,
          useFactory: (credentials: SocialCredentialVault, instagram: InstagramAccountCredentialResolver) => new InstagramPublicationReader(credentials, process.env, fetch, instagram),
          inject: [SOCIAL_CREDENTIAL_VAULT, InstagramAccountCredentialResolver],
        },
        {
          provide: FacebookPagesPublicationReader,
          useFactory: (credentials: SocialCredentialVault, instagram: InstagramAccountCredentialResolver) => new FacebookPagesPublicationReader(credentials, process.env, fetch, instagram),
          inject: [SOCIAL_CREDENTIAL_VAULT, InstagramAccountCredentialResolver],
        },
        {
          provide: SOCIAL_PUBLICATION_READERS,
          useFactory: (youtube: YouTubePublicationReader, instagram: InstagramPublicationReader, facebook: FacebookPagesPublicationReader, tiktok: TikTokBusinessPublicationReader): SocialPublicationReaderRegistry => ({ youtube, instagram, facebook, tiktok }),
          inject: [YouTubePublicationReader, InstagramPublicationReader, FacebookPagesPublicationReader, TikTokBusinessPublicationReader],
        },
        {
          provide: YOUTUBE_COMMUNITY_ADAPTER,
          useFactory: (credentials: YouTubeAccountCredentialProvider) => new YouTubeCommunityAdapter(credentials),
          inject: [YOUTUBE_ACCOUNT_CREDENTIAL_PROVIDER],
        },
        {
          provide: TikTokBusinessCommunityAdapter,
          useFactory: (credentials: SocialCredentialVault, tokens: TikTokAccountCredentialResolver) => new TikTokBusinessCommunityAdapter(credentials, fetch, tokens),
          inject: [SOCIAL_CREDENTIAL_VAULT, TikTokAccountCredentialResolver],
        },
        {
          provide: InstagramCommunityAdapter,
          useFactory: (credentials: SocialCredentialVault, instagram: InstagramAccountCredentialResolver) => new InstagramCommunityAdapter(credentials, process.env, fetch, instagram),
          inject: [SOCIAL_CREDENTIAL_VAULT, InstagramAccountCredentialResolver],
        },
        {
          provide: FacebookPagesCommunityAdapter,
          useFactory: (credentials: SocialCredentialVault, instagram: InstagramAccountCredentialResolver) => new FacebookPagesCommunityAdapter(credentials, process.env, fetch, instagram),
          inject: [SOCIAL_CREDENTIAL_VAULT, InstagramAccountCredentialResolver],
        },
        { provide: SOCIAL_COMMENT_READER, useExisting: YOUTUBE_COMMUNITY_ADAPTER },
        {
          provide: SOCIAL_COMMENT_RESPONDER,
          useFactory: (youtube: YouTubeCommunityAdapter, instagram: InstagramCommunityAdapter, facebook: FacebookPagesCommunityAdapter, tiktok: TikTokBusinessCommunityAdapter): SocialCommentResponder => new PlatformSocialCommentResponder({ youtube, instagram, facebook, tiktok }),
          inject: [YOUTUBE_COMMUNITY_ADAPTER, InstagramCommunityAdapter, FacebookPagesCommunityAdapter, TikTokBusinessCommunityAdapter],
        },
        {
          provide: SOCIAL_COMMENT_LIKER,
          useFactory: (facebook: FacebookPagesCommunityAdapter, tiktok: TikTokBusinessCommunityAdapter): SocialCommentLiker => new PlatformSocialCommentLiker({ facebook, tiktok }),
          inject: [FacebookPagesCommunityAdapter, TikTokBusinessCommunityAdapter],
        },
        {
          provide: SOCIAL_COMMENT_READERS,
          useFactory: (youtube: YouTubeCommunityAdapter, instagram: InstagramCommunityAdapter, facebook: FacebookPagesCommunityAdapter, tiktok: TikTokBusinessCommunityAdapter): SocialCommentReaderRegistry => ({ youtube, instagram, facebook, tiktok }),
          inject: [YOUTUBE_COMMUNITY_ADAPTER, InstagramCommunityAdapter, FacebookPagesCommunityAdapter, TikTokBusinessCommunityAdapter],
        },
        {
          provide: ConnectSocialAccount,
          useFactory: (accounts: SocialAccountRepository, tenant: LocalPilotTenantContext, ids: UuidSocialAccountIdGenerator) => new ConnectSocialAccount(accounts, tenant, ids),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, LocalPilotTenantContext, UuidSocialAccountIdGenerator],
        },
        {
          provide: ListConnectedSocialAccounts,
          useFactory: (accounts: SocialAccountRepository, tenant: LocalPilotTenantContext) => new ListConnectedSocialAccounts(accounts, tenant),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: DisconnectSocialAccount,
          useFactory: (disconnector: SocialAccountDisconnector, tenant: LocalPilotTenantContext) => new DisconnectSocialAccount(disconnector, tenant),
          inject: [SOCIAL_ACCOUNT_DISCONNECTOR, LocalPilotTenantContext],
        },
        {
          provide: ListSocialPublications,
          useFactory: (accounts: SocialAccountRepository, tenant: LocalPilotTenantContext, readers: SocialPublicationReaderRegistry, publications: SocialPublicationRepository) => new ListSocialPublications(accounts, tenant, readers, publications),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, LocalPilotTenantContext, SOCIAL_PUBLICATION_READERS, SOCIAL_PUBLICATION_REPOSITORY],
        },
        {
          provide: RefreshEpisodeSuggestions,
          useFactory: (accounts: SocialAccountRepository, publications: SocialPublicationRepository, reviews: EpisodeReviewRepository, classifier: JevPublicationEpisodeClassifier, localization: JsonLocalizationAdapter, tenant: LocalPilotTenantContext) => new RefreshEpisodeSuggestions(accounts, publications, reviews, classifier, localization, tenant),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_PUBLICATION_REPOSITORY, EPISODE_REVIEW_REPOSITORY, JevPublicationEpisodeClassifier, JsonLocalizationAdapter, LocalPilotTenantContext],
        },
        {
          provide: GetEpisodeReview,
          useFactory: (reviews: EpisodeReviewRepository, tenant: LocalPilotTenantContext) => new GetEpisodeReview(reviews, tenant),
          inject: [EPISODE_REVIEW_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: ConfirmEpisodeSetupSeries,
          useFactory: (reviews: EpisodeReviewRepository, tenant: LocalPilotTenantContext) => new ConfirmEpisodeSetupSeries(reviews, tenant),
          inject: [EPISODE_REVIEW_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: ConfirmEpisodeSetupSeasons,
          useFactory: (reviews: EpisodeReviewRepository, tenant: LocalPilotTenantContext) => new ConfirmEpisodeSetupSeasons(reviews, tenant),
          inject: [EPISODE_REVIEW_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: ApproveEpisodeSuggestionGroup,
          useFactory: (reviews: EpisodeReviewRepository, tenant: LocalPilotTenantContext) => new ApproveEpisodeSuggestionGroup(reviews, tenant),
          inject: [EPISODE_REVIEW_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: DecideEpisodeSuggestions,
          useFactory: (reviews: EpisodeReviewRepository, tenant: LocalPilotTenantContext) => new DecideEpisodeSuggestions(reviews, tenant),
          inject: [EPISODE_REVIEW_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: CreateAnalyticsSeries,
          useFactory: (entries: AnalyticsEntryRepository, tenant: LocalPilotTenantContext) => new CreateAnalyticsSeries(entries, tenant),
          inject: [ANALYTICS_ENTRY_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: CreateAnalyticsEpisode,
          useFactory: (entries: AnalyticsEntryRepository, tenant: LocalPilotTenantContext) => new CreateAnalyticsEpisode(entries, tenant),
          inject: [ANALYTICS_ENTRY_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: CreateManualAnalyticsEpisode,
          useFactory: (entries: AnalyticsEntryRepository, tenant: LocalPilotTenantContext) => new CreateManualAnalyticsEpisode(entries, tenant),
          inject: [ANALYTICS_ENTRY_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: ListAvailableEpisodePublications,
          useFactory: (entries: AnalyticsEntryRepository, tenant: LocalPilotTenantContext) => new ListAvailableEpisodePublications(entries, tenant),
          inject: [ANALYTICS_ENTRY_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: UpdateAnalyticsEpisodeEconomics,
          useFactory: (entries: AnalyticsEntryRepository, tenant: LocalPilotTenantContext) => new UpdateAnalyticsEpisodeEconomics(entries, tenant),
          inject: [ANALYTICS_ENTRY_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: UpsertAnalyticsPerformanceObservation,
          useFactory: (entries: AnalyticsEntryRepository, tenant: LocalPilotTenantContext) => new UpsertAnalyticsPerformanceObservation(entries, tenant),
          inject: [ANALYTICS_ENTRY_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: UpsertAnalyticsFollowerSnapshot,
          useFactory: (entries: AnalyticsEntryRepository, tenant: LocalPilotTenantContext) => new UpsertAnalyticsFollowerSnapshot(entries, tenant),
          inject: [ANALYTICS_ENTRY_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: UpsertAnalyticsMonthlyRevenue,
          useFactory: (entries: AnalyticsEntryRepository, tenant: LocalPilotTenantContext) => new UpsertAnalyticsMonthlyRevenue(entries, tenant),
          inject: [ANALYTICS_ENTRY_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: SyncPublicationComments,
          useFactory: (accounts: SocialAccountRepository, comments: SocialCommentRepository, events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext, readers: SocialCommentReaderRegistry) => new SyncPublicationComments(accounts, comments, events, tenant, readers),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_COMMENT_REPOSITORY, COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext, SOCIAL_COMMENT_READERS],
        },
        {
          provide: ListPublicationComments,
          useFactory: (accounts: SocialAccountRepository, comments: SocialCommentRepository, tenant: LocalPilotTenantContext) => new ListPublicationComments(accounts, comments, tenant),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_COMMENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: GetCommentSummary,
          useFactory: (comments: SocialCommentRepository, tenant: LocalPilotTenantContext) => new GetCommentSummary(comments, tenant),
          inject: [SOCIAL_COMMENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: ListSentRepliesReport,
          useFactory: (reports: SentReplyReportRepository, tenant: LocalPilotTenantContext) => new ListSentRepliesReport(reports, tenant),
          inject: [SENT_REPLY_REPORT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: RecordCommentAnalysis,
          useFactory: (events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new RecordCommentAnalysis(events, tenant),
          inject: [COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: CorrectCommentAnalysis,
          useFactory: (events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new CorrectCommentAnalysis(events, tenant),
          inject: [COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: RecordResponseSuggestion,
          useFactory: (events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new RecordResponseSuggestion(events, tenant),
          inject: [COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: ReviseResponseSuggestion,
          useFactory: (events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new ReviseResponseSuggestion(events, tenant),
          inject: [COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: RecordManualResponse,
          useFactory: (events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new RecordManualResponse(events, tenant),
          inject: [COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: ReviseManualResponse,
          useFactory: (events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new ReviseManualResponse(events, tenant),
          inject: [COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: RecordResponseEvaluation,
          useFactory: (events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new RecordResponseEvaluation(events, tenant),
          inject: [COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: SendManualCommentReply,
          useFactory: (accounts: SocialAccountRepository, comments: SocialCommentRepository, responder: SocialCommentResponder, events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext, attemptIds: ManualReplyAttemptIdGenerator, refinementPairs: RecordResponseRefinementPair) => new SendManualCommentReply(accounts, comments, responder, events, tenant, attemptIds, refinementPairs),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_COMMENT_REPOSITORY, SOCIAL_COMMENT_RESPONDER, COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext, UuidManualReplyAttemptIdGenerator, RecordResponseRefinementPair],
        },
        {
          provide: SetCommentLike,
          useFactory: (accounts: SocialAccountRepository, comments: SocialCommentRepository, liker: SocialCommentLiker, events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new SetCommentLike(accounts, comments, liker, events, tenant),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_COMMENT_REPOSITORY, SOCIAL_COMMENT_LIKER, COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: ListCommentWorkflow,
          useFactory: (events: CommentWorkflowEventRepository, accounts: SocialAccountRepository, tenant: LocalPilotTenantContext) => new ListCommentWorkflow(events, accounts, tenant),
          inject: [COMMENT_WORKFLOW_EVENT_REPOSITORY, SOCIAL_ACCOUNT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: EvaluateComment,
          useFactory: (accounts: SocialAccountRepository, comments: SocialCommentRepository, evaluator: CommentEvaluator, record: RecordCommentAnalysis, events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new EvaluateComment(accounts, comments, evaluator, record, events, tenant),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_COMMENT_REPOSITORY, COMMENT_EVALUATOR, RecordCommentAnalysis, COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: EvaluateResponseSuggestion,
          useFactory: (accounts: SocialAccountRepository, comments: SocialCommentRepository, evaluator: ResponseEvaluator, record: RecordResponseEvaluation, events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext, schedules: VerifiedReleaseScheduleRepository, tenantSchedules: TenantVerifiedReleaseScheduleRepository) => new EvaluateResponseSuggestion(accounts, comments, evaluator, record, events, tenant, schedules, tenantSchedules),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_COMMENT_REPOSITORY, RESPONSE_EVALUATOR, RecordResponseEvaluation, COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext, VERIFIED_RELEASE_SCHEDULE_REPOSITORY, TENANT_VERIFIED_RELEASE_SCHEDULE_REPOSITORY],
        },
        {
          provide: GenerateCommentResponseSuggestion,
          useFactory: (accounts: SocialAccountRepository, comments: SocialCommentRepository, generator: ResponseSuggestionGenerator, record: RecordResponseSuggestion, events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext, toneSettings: ResponseToneSettingsRepository, tenantToneSettings: TenantResponseToneSettingsRepository, schedules: VerifiedReleaseScheduleRepository, tenantSchedules: TenantVerifiedReleaseScheduleRepository) => new GenerateCommentResponseSuggestion(accounts, comments, generator, record, events, tenant, toneSettings, tenantToneSettings, schedules, tenantSchedules),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_COMMENT_REPOSITORY, RESPONSE_SUGGESTION_GENERATOR, RecordResponseSuggestion, COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext, RESPONSE_TONE_SETTINGS_REPOSITORY, TENANT_RESPONSE_TONE_SETTINGS_REPOSITORY, VERIFIED_RELEASE_SCHEDULE_REPOSITORY, TENANT_VERIFIED_RELEASE_SCHEDULE_REPOSITORY],
        },
        {
          provide: RunCommentWorkflowBatch,
          useFactory: (accounts: SocialAccountRepository, comments: SocialCommentRepository, publications: ListSocialPublications, sync: SyncPublicationComments, classify: EvaluateComment, generate: GenerateCommentResponseSuggestion, tenant: LocalPilotTenantContext, batchIds: BatchOperationIdGenerator) => new RunCommentWorkflowBatch(accounts, comments, publications, sync, classify, generate, tenant, batchIds),
          inject: [SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_COMMENT_REPOSITORY, ListSocialPublications, SyncPublicationComments, EvaluateComment, GenerateCommentResponseSuggestion, LocalPilotTenantContext, UuidBatchOperationIdGenerator],
        },
        {
          provide: ListCommentWorkflowBatchEvents,
          useFactory: (events: CommentWorkflowEventRepository, tenant: LocalPilotTenantContext) => new ListCommentWorkflowBatchEvents(events, tenant),
          inject: [COMMENT_WORKFLOW_EVENT_REPOSITORY, LocalPilotTenantContext],
        },
        {
          provide: BeginYouTubeOAuth,
          useFactory: (states: YouTubeOAuthFlowStateStore, provider: YouTubeOAuthProvider) => new BeginYouTubeOAuth(states, provider),
          inject: [InMemoryYouTubeOAuthFlowStateStore, YouTubeOAuthClient],
        },
        {
          provide: CompleteYouTubeOAuth,
          useFactory: (
            states: YouTubeOAuthFlowStateStore,
            provider: YouTubeOAuthProvider,
            tenant: LocalPilotTenantContext,
            accounts: SocialAccountRepository,
            connect: ConnectSocialAccount,
            credentials: SocialCredentialVault,
          ) => new CompleteYouTubeOAuth(states, provider, tenant, accounts, connect, credentials),
          inject: [InMemoryYouTubeOAuthFlowStateStore, YouTubeOAuthClient, LocalPilotTenantContext, SOCIAL_ACCOUNT_REPOSITORY, ConnectSocialAccount, SOCIAL_CREDENTIAL_VAULT],
        },
        {
          provide: BeginInstagramOAuth,
          useFactory: (states: InstagramOAuthFlowStateStore, provider: InstagramOAuthProvider) => new BeginInstagramOAuth(states, provider),
          inject: [InMemoryInstagramOAuthFlowStateStore, InstagramOAuthClient],
        },
        {
          provide: CompleteInstagramOAuth,
          useFactory: (states: InstagramOAuthFlowStateStore, provider: InstagramOAuthProvider, tenant: LocalPilotTenantContext, accounts: SocialAccountRepository, connect: ConnectSocialAccount, credentials: SocialCredentialVault) => new CompleteInstagramOAuth(states, provider, tenant, accounts, connect, credentials),
          inject: [InMemoryInstagramOAuthFlowStateStore, InstagramOAuthClient, LocalPilotTenantContext, SOCIAL_ACCOUNT_REPOSITORY, ConnectSocialAccount, SOCIAL_CREDENTIAL_VAULT],
        },
        {
          provide: BeginFacebookOAuth,
          useFactory: (states: FacebookOAuthFlowStateStore, provider: FacebookOAuthProvider) => new BeginFacebookOAuth(states, provider),
          inject: [InMemoryFacebookOAuthFlowStateStore, FacebookOAuthClient],
        },
        {
          provide: CompleteFacebookOAuth,
          useFactory: (states: FacebookOAuthFlowStateStore, provider: FacebookOAuthProvider, tenant: LocalPilotTenantContext) => new CompleteFacebookOAuth(states, provider, tenant),
          inject: [InMemoryFacebookOAuthFlowStateStore, FacebookOAuthClient, LocalPilotTenantContext],
        },
        {
          provide: SelectFacebookPage,
          useFactory: (provider: FacebookOAuthProvider, tenant: LocalPilotTenantContext, accounts: SocialAccountRepository, connect: ConnectSocialAccount, credentials: SocialCredentialVault) => new SelectFacebookPage(provider, tenant, accounts, connect, credentials),
          inject: [FacebookOAuthClient, LocalPilotTenantContext, SOCIAL_ACCOUNT_REPOSITORY, ConnectSocialAccount, SOCIAL_CREDENTIAL_VAULT],
        },
        {
          provide: BeginTikTokBusinessOAuth,
          useFactory: (states: TikTokBusinessOAuthFlowStateStore, provider: TikTokBusinessOAuthProvider) => new BeginTikTokBusinessOAuth(states, provider),
          inject: [InMemoryTikTokBusinessOAuthFlowStateStore, TikTokBusinessOAuthClient],
        },
        {
          provide: CompleteTikTokBusinessOAuth,
          useFactory: (states: TikTokBusinessOAuthFlowStateStore, provider: TikTokBusinessOAuthProvider, tenant: LocalPilotTenantContext, accounts: SocialAccountRepository, connect: ConnectSocialAccount, credentials: SocialCredentialVault) => new CompleteTikTokBusinessOAuth(states, provider, tenant, accounts, connect, credentials),
          inject: [InMemoryTikTokBusinessOAuthFlowStateStore, TikTokBusinessOAuthClient, LocalPilotTenantContext, SOCIAL_ACCOUNT_REPOSITORY, ConnectSocialAccount, SOCIAL_CREDENTIAL_VAULT],
        },
      ],
      exports: [RELATIONAL_DATABASE, SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_PUBLICATION_REPOSITORY, EPISODE_REVIEW_REPOSITORY, ANALYTICS_ENTRY_REPOSITORY, CreateAnalyticsSeries, CreateAnalyticsEpisode, CreateManualAnalyticsEpisode, ListAvailableEpisodePublications, UpdateAnalyticsEpisodeEconomics, UpsertAnalyticsPerformanceObservation, UpsertAnalyticsFollowerSnapshot, UpsertAnalyticsMonthlyRevenue, SOCIAL_COMMENT_READER, SOCIAL_COMMENT_RESPONDER, SOCIAL_COMMENT_LIKER, SOCIAL_COMMENT_REPOSITORY, SENT_REPLY_REPORT_REPOSITORY, COMMENT_WORKFLOW_EVENT_REPOSITORY, VERIFIED_RELEASE_SCHEDULE_REPOSITORY, GetResponseGenerationSettings, UpdateResponseGenerationSettings, GetAIProviderAccessStatus, UpdateAIProviderAccessSettings, GetAccountResponseToneSettings, UpdateAccountResponseToneSettings, GetTenantResponseToneSettings, UpdateTenantResponseToneSettings, GetVerifiedReleaseSchedule, UpdateVerifiedReleaseSchedule, GetTenantVerifiedReleaseSchedule, UpdateTenantVerifiedReleaseSchedule, SyncPublicationComments, ListPublicationComments, GetCommentSummary, ListSentRepliesReport, RefreshEpisodeSuggestions, GetEpisodeReview, ConfirmEpisodeSetupSeries, ConfirmEpisodeSetupSeasons, ApproveEpisodeSuggestionGroup, DecideEpisodeSuggestions, SetCommentLike, RecordCommentAnalysis, CorrectCommentAnalysis, RecordResponseSuggestion, ReviseResponseSuggestion, RecordResponseEvaluation, RecordManualResponse, ReviseManualResponse, SendManualCommentReply, ListCommentWorkflow, EvaluateComment, EvaluateResponseSuggestion, GenerateCommentResponseSuggestion, RunCommentWorkflowBatch, ListCommentWorkflowBatchEvents, ConnectSocialAccount, ListConnectedSocialAccounts, DisconnectSocialAccount, ListSocialPublications, BeginYouTubeOAuth, CompleteYouTubeOAuth, BeginInstagramOAuth, CompleteInstagramOAuth, BeginFacebookOAuth, CompleteFacebookOAuth, SelectFacebookPage, BeginTikTokBusinessOAuth, CompleteTikTokBusinessOAuth],
    };
  }
}
