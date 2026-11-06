import { DynamicModule, Module } from '@nestjs/common';
import type { PoolConfig } from 'pg';
import { PostgresPersistenceModule } from '../../infrastructure/persistence/postgres-persistence.module';
import { SocialPublicationsController } from './social-publications.controller';
import { YouTubeOAuthConnectionController } from './youtube-oauth-connection.controller';
import { InstagramOAuthConnectionController } from './instagram-oauth-connection.controller';
import { FacebookOAuthConnectionController } from './facebook-oauth-connection.controller';
import { TikTokBusinessOAuthConnectionController } from './tiktok-business-oauth-connection.controller';
import { SocialCommentsController } from './social-comments.controller';
import { SocialCommentSummaryController } from './social-comment-summary.controller';
import { SentRepliesReportController } from './sent-replies-report.controller';
import { CommentWorkflowAuditController } from './comment-workflow-audit.controller';
import { CommentIntelligenceController } from './comment-intelligence.controller';
import { ResponseGenerationSettingsController } from './response-generation-settings.controller';
import { ResponseToneSettingsController } from './response-tone-settings.controller';
import { TenantResponseToneSettingsController } from './tenant-response-tone-settings.controller';
import { VerifiedReleaseScheduleController } from './verified-release-schedule.controller';
import { TenantVerifiedReleaseScheduleController } from './tenant-verified-release-schedule.controller';
import { CommentWorkflowBatchController } from './comment-workflow-batch.controller';
import { SocialAccountsController } from './social-accounts.controller';
import { AIProviderAccessSettingsController } from './ai-provider-access-settings.controller';
import { EpisodeReviewController } from './episode-review.controller';
import { AnalyticsEntryController } from './analytics-entry.controller';
import { ResponseRefinementAnalysisController } from './response-refinement-analysis.controller';

@Module({})
export class AppModule {
  static withPostgres(config: PoolConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [PostgresPersistenceModule.register(config)],
      controllers: [SocialPublicationsController, SocialAccountsController, YouTubeOAuthConnectionController, InstagramOAuthConnectionController, FacebookOAuthConnectionController, TikTokBusinessOAuthConnectionController, SocialCommentsController, SocialCommentSummaryController, SentRepliesReportController, CommentWorkflowAuditController, CommentIntelligenceController, ResponseGenerationSettingsController, AIProviderAccessSettingsController, ResponseToneSettingsController, TenantResponseToneSettingsController, VerifiedReleaseScheduleController, TenantVerifiedReleaseScheduleController, CommentWorkflowBatchController, EpisodeReviewController, AnalyticsEntryController, ResponseRefinementAnalysisController],
    };
  }
}
