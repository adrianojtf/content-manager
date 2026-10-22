import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialCommentPlatformSummary, SocialCommentRepository } from '../ports/social-comment-repository.port';

export interface CommentSummaryTotals {
  readonly totalComments: number;
  readonly unansweredComments: number;
  readonly unevaluatedComments: number;
  readonly sentRepliesToday: number;
}

export interface CommentSummaryView {
  readonly platforms: readonly SocialCommentPlatformSummary[];
  readonly totals: CommentSummaryTotals;
}

export class GetCommentSummary {
  constructor(
    private readonly comments: SocialCommentRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(): Promise<CommentSummaryView> {
    const tenantId = await this.tenant.resolveTenantId();
    const now = new Date(this.now());
    const sentSince = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const platforms = await this.comments.summarizeByTenant(tenantId, now.toISOString(), sentSince);
    const totals = platforms.reduce<CommentSummaryTotals>((sum, platform) => ({
      totalComments: sum.totalComments + platform.totalComments,
      unansweredComments: sum.unansweredComments + platform.unansweredComments,
      unevaluatedComments: sum.unevaluatedComments + platform.unevaluatedComments,
      sentRepliesToday: sum.sentRepliesToday + platform.sentRepliesToday,
    }), { totalComments: 0, unansweredComments: 0, unevaluatedComments: 0, sentRepliesToday: 0 });
    return { platforms, totals };
  }
}
