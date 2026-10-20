import type { SocialAccountRepository } from '../../application/ports/social-account-repository.port';
import { SocialAccount } from '../../domain/social/social-account';
import { SocialAccountInvariantError } from '../../domain/social/social-account-invariant-error';
import { parseSocialAccountId, type SocialAccountId } from '../../domain/social/social-account-id';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

interface SocialAccountRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  platform: string;
  external_account_id: string;
  display_name: string | null;
  credential_reference: string;
}

export class PostgresSocialAccountRepository implements SocialAccountRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async save(tenantId: string, account: SocialAccount): Promise<void> {
    if (account.tenantId !== tenantId) {
      throw new SocialAccountInvariantError('SOCIAL_ACCOUNT_TENANT_MISMATCH');
    }
    const providerIdentity = await this.findByProviderIdentity(tenantId, account.platform, account.externalAccountId);
    if (providerIdentity && providerIdentity.id !== account.id) {
      throw new SocialAccountInvariantError('SOCIAL_ACCOUNT_ALREADY_CONNECTED');
    }

    try {
      if (await this.updateForTenant(tenantId, account)) {
        return;
      }
      await this.database.query(
        `INSERT INTO social_accounts (id, tenant_id, platform, external_account_id, display_name, credential_reference)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [account.id, tenantId, account.platform, account.externalAccountId, account.displayName, account.credentialReference],
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
      const conflictingIdentity = await this.findByProviderIdentity(tenantId, account.platform, account.externalAccountId);
      if (conflictingIdentity && conflictingIdentity.id !== account.id) {
        throw new SocialAccountInvariantError('SOCIAL_ACCOUNT_ALREADY_CONNECTED');
      }
      if (await this.updateForTenant(tenantId, account)) {
        return;
      }
      throw new SocialAccountInvariantError('SOCIAL_ACCOUNT_TENANT_MISMATCH');
    }
  }

  private async updateForTenant(tenantId: string, account: SocialAccount): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `UPDATE social_accounts
       SET platform = $3, external_account_id = $4, display_name = $5, credential_reference = $6, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id`,
      [tenantId, account.id, account.platform, account.externalAccountId, account.displayName, account.credentialReference],
    );
    return rows.length === 1;
  }

  async findById(tenantId: string, id: SocialAccountId): Promise<SocialAccount | null> {
    const { rows } = await this.database.query<SocialAccountRow>(
      `SELECT id, tenant_id, platform, external_account_id, display_name, credential_reference
       FROM social_accounts WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? this.restore(rows[0]) : null;
  }

  async findByProviderIdentity(tenantId: string, platform: SocialAccount['platform'], externalAccountId: string): Promise<SocialAccount | null> {
    const { rows } = await this.database.query<SocialAccountRow>(
      `SELECT id, tenant_id, platform, external_account_id, display_name, credential_reference
       FROM social_accounts WHERE tenant_id = $1 AND platform = $2 AND external_account_id = $3`,
      [tenantId, platform, externalAccountId],
    );
    return rows[0] ? this.restore(rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<readonly SocialAccount[]> {
    const { rows } = await this.database.query<SocialAccountRow>(
      `SELECT id, tenant_id, platform, external_account_id, display_name, credential_reference
       FROM social_accounts WHERE tenant_id = $1 ORDER BY created_at, id`,
      [tenantId],
    );
    return rows.map((row) => this.restore(row));
  }

  private restore(row: SocialAccountRow): SocialAccount {
    return SocialAccount.restore({
      id: parseSocialAccountId(row.id),
      tenantId: row.tenant_id,
      platform: row.platform,
      externalAccountId: row.external_account_id,
      displayName: row.display_name,
      credentialReference: row.credential_reference,
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && (('code' in error && error.code === '23505')
        || ('message' in error && typeof error.message === 'string' && error.message.includes('duplicate key value violates unique constraint')));
  }
}
