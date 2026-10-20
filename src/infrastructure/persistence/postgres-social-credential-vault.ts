import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { SocialCredentialVault, StoreSocialCredentialsInput } from '../../application/ports/social-credential-vault.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';
import type { SocialPlatform } from '../../domain/social/social-account';
import { SocialCredentialVaultError } from './social-credential-vault-error';

export type SocialCredentialEnvironment = Readonly<Record<string, string | undefined>>;

interface CredentialRow extends Record<string, unknown> {
  ciphertext: string;
  nonce: string;
  auth_tag: string;
  expires_at: Date | string | null;
}

interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly refreshTokenExpiresAt: string | null;
  readonly grantedScopes: readonly string[];
}

export class PostgresSocialCredentialVault implements SocialCredentialVault {
  constructor(
    private readonly database: RelationalDatabase,
    private readonly environment: SocialCredentialEnvironment = process.env,
    private readonly now: () => number = Date.now,
  ) {}

  async storeCredentials(input: StoreSocialCredentialsInput): Promise<string> {
    this.validateInput(input);
    const reference = randomUUID();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), nonce);
    cipher.setAAD(this.associatedData(input.tenantId, input.platform, reference));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ accessToken: input.accessToken, refreshToken: input.refreshToken, refreshTokenExpiresAt: input.refreshTokenExpiresAt ?? null, grantedScopes: input.grantedScopes }), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    await this.database.query(
      `INSERT INTO social_credentials (tenant_id, credential_reference, platform, ciphertext, nonce, auth_tag, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.tenantId, reference, input.platform, ciphertext.toString('base64'), nonce.toString('base64'), authTag.toString('base64'), input.expiresAt],
    );
    return reference;
  }

  async resolveAccessToken(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null> {
    const row = await this.findCredential(tenantId, credentialReference, platform);
    if (!row || this.isExpired(row.expires_at)) {
      return null;
    }
    const tokens = this.decryptCredentials(tenantId, credentialReference, platform, row);
    return typeof tokens.accessToken === 'string' && tokens.accessToken.trim() ? tokens.accessToken : null;
  }

  async resolveRefreshToken(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null> {
    const row = await this.findCredential(tenantId, credentialReference, platform);
    if (!row) {
      return null;
    }
    const tokens = this.decryptCredentials(tenantId, credentialReference, platform, row);
    return tokens.refreshToken?.trim() || null;
  }

  async resolveRefreshTokenExpiresAt(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null> {
    const row = await this.findCredential(tenantId, credentialReference, platform);
    if (!row) return null;
    const tokens = this.decryptCredentials(tenantId, credentialReference, platform, row);
    return tokens.refreshTokenExpiresAt;
  }

  async resolveAccessTokenExpiresAt(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null> {
    const row = await this.findCredential(tenantId, credentialReference, platform);
    if (!row || row.expires_at === null) {
      return null;
    }
    const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
    return Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : null;
  }

  async updateAccessToken(
    tenantId: string,
    credentialReference: string,
    platform: SocialPlatform,
    accessToken: string,
    expiresAt: string,
    refreshToken?: string | null,
    grantedScopes?: readonly string[],
    refreshTokenExpiresAt?: string | null,
  ): Promise<void> {
    if (!accessToken.trim() || !Number.isFinite(Date.parse(expiresAt))
      || (refreshToken !== undefined && refreshToken !== null && !refreshToken.trim())
      || (grantedScopes !== undefined && (!grantedScopes.length || grantedScopes.some((scope) => !scope.trim())))
      || (refreshTokenExpiresAt !== undefined && refreshTokenExpiresAt !== null && !Number.isFinite(Date.parse(refreshTokenExpiresAt)))) {
      throw new SocialCredentialVaultError('SOCIAL_CREDENTIAL_INPUT_INVALID');
    }
    const row = await this.findCredential(tenantId, credentialReference, platform);
    if (!row) {
      throw new SocialCredentialVaultError('SOCIAL_CREDENTIAL_NOT_FOUND');
    }
    const tokens = this.decryptCredentials(tenantId, credentialReference, platform, row);
    const updatedTokens = {
      ...tokens,
      accessToken,
      ...(refreshToken !== undefined ? { refreshToken } : {}),
      ...(grantedScopes !== undefined ? { grantedScopes } : {}),
      ...(refreshTokenExpiresAt !== undefined ? { refreshTokenExpiresAt } : {}),
    };
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), nonce);
    cipher.setAAD(this.associatedData(tenantId, platform, credentialReference));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(updatedTokens), 'utf8'),
      cipher.final(),
    ]);
    await this.database.query(
      `UPDATE social_credentials SET ciphertext = $4, nonce = $5, auth_tag = $6, expires_at = $7
       WHERE tenant_id = $1 AND credential_reference = $2 AND platform = $3`,
      [tenantId, credentialReference, platform, ciphertext.toString('base64'), nonce.toString('base64'), cipher.getAuthTag().toString('base64'), expiresAt],
    );
  }

  async hasScopes(tenantId: string, credentialReference: string, platform: SocialPlatform, scopes: readonly string[]): Promise<boolean> {
    const row = await this.findCredential(tenantId, credentialReference, platform);
    if (!row) {
      return false;
    }
    const tokens = this.decryptCredentials(tenantId, credentialReference, platform, row);
    return scopes.every((scope) => tokens.grantedScopes.includes(scope));
  }

  private async findCredential(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<CredentialRow | null> {
    const { rows } = await this.database.query<CredentialRow>(
      `SELECT ciphertext, nonce, auth_tag, expires_at FROM social_credentials
       WHERE tenant_id = $1 AND credential_reference = $2 AND platform = $3`,
      [tenantId, credentialReference, platform],
    );
    return rows[0] ?? null;
  }

  private decryptCredentials(tenantId: string, credentialReference: string, platform: SocialPlatform, row: CredentialRow): StoredTokens {
    const key = this.encryptionKey();
    try {
      const nonce = this.decodeBase64(row.nonce);
      const authTag = this.decodeBase64(row.auth_tag);
      const ciphertext = this.decodeBase64(row.ciphertext);
      if (nonce.length !== 12 || authTag.length !== 16) {
        throw new Error();
      }
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(this.associatedData(tenantId, platform, credentialReference));
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      const tokens = JSON.parse(plaintext) as Partial<StoredTokens>;
      if (typeof tokens.accessToken !== 'string' || !Array.isArray(tokens.grantedScopes) || tokens.grantedScopes.some((scope) => typeof scope !== 'string')
        || (tokens.refreshToken !== undefined && tokens.refreshToken !== null && typeof tokens.refreshToken !== 'string')
        || (tokens.refreshTokenExpiresAt !== undefined && tokens.refreshTokenExpiresAt !== null
          && (typeof tokens.refreshTokenExpiresAt !== 'string' || !Number.isFinite(Date.parse(tokens.refreshTokenExpiresAt))))) {
        throw new Error();
      }
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
        grantedScopes: tokens.grantedScopes,
      };
    } catch {
      throw new SocialCredentialVaultError('SOCIAL_CREDENTIAL_DECRYPTION_FAILED');
    }
  }

  async deleteCredentials(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<void> {
    await this.database.query(
      'DELETE FROM social_credentials WHERE tenant_id = $1 AND credential_reference = $2 AND platform = $3',
      [tenantId, credentialReference, platform],
    );
  }

  private validateInput(input: StoreSocialCredentialsInput): void {
    if (!input.tenantId.trim() || !input.accessToken.trim() || (input.refreshToken !== null && !input.refreshToken.trim())
      || !input.grantedScopes.length || input.grantedScopes.some((scope) => !scope.trim())) {
      throw new SocialCredentialVaultError('SOCIAL_CREDENTIAL_INPUT_INVALID');
    }
    if ((input.expiresAt !== null && !Number.isFinite(Date.parse(input.expiresAt)))
      || (input.refreshTokenExpiresAt !== undefined && input.refreshTokenExpiresAt !== null && !Number.isFinite(Date.parse(input.refreshTokenExpiresAt)))) {
      throw new SocialCredentialVaultError('SOCIAL_CREDENTIAL_INPUT_INVALID');
    }
  }

  private encryptionKey(): Buffer {
    const encoded = this.environment.SOCIAL_CREDENTIAL_ENCRYPTION_KEY?.trim();
    if (!encoded) {
      throw new SocialCredentialVaultError('SOCIAL_CREDENTIAL_ENCRYPTION_KEY_REQUIRED');
    }
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded) {
      throw new SocialCredentialVaultError('SOCIAL_CREDENTIAL_ENCRYPTION_KEY_INVALID');
    }
    return key;
  }

  private decodeBase64(value: string): Buffer {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) {
      throw new Error();
    }
    return decoded;
  }

  private associatedData(tenantId: string, platform: SocialPlatform, reference: string): Buffer {
    return Buffer.from(`${tenantId}\u0000${platform}\u0000${reference}`);
  }

  private isExpired(value: Date | string | null): boolean {
    return value !== null && new Date(value).getTime() <= this.now();
  }
}
