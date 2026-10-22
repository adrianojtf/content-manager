import type { SocialAccountDisconnector } from '../../application/ports/social-account-disconnector.port';
import type { SocialAccountId } from '../../domain/social/social-account-id';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

interface AccountCredentialRow extends Record<string, unknown> {
  platform: string;
  credential_reference: string;
}

export class PostgresSocialAccountDisconnector implements SocialAccountDisconnector {
  constructor(private readonly database: RelationalDatabase) {}

  async disconnect(tenantId: string, accountId: SocialAccountId): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const { rows } = await transaction.query<AccountCredentialRow>(
        `DELETE FROM social_accounts
         WHERE tenant_id = $1 AND id = $2
         RETURNING platform, credential_reference`,
        [tenantId, accountId],
      );
      const account = rows[0];
      if (!account) return false;

      await transaction.query(
        `DELETE FROM social_credentials
         WHERE tenant_id = $1 AND credential_reference = $2 AND platform = $3`,
        [tenantId, account.credential_reference, account.platform],
      );
      return true;
    });
  }
}
