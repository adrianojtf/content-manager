ALTER TABLE social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_platform_check;
ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_platform_check CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok'));

ALTER TABLE social_credentials
  DROP CONSTRAINT IF EXISTS social_credentials_platform_check;
ALTER TABLE social_credentials
  ADD CONSTRAINT social_credentials_platform_check CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok'));

ALTER TABLE social_comments
  DROP CONSTRAINT IF EXISTS social_comments_platform_check;
ALTER TABLE social_comments
  ADD CONSTRAINT social_comments_platform_check CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok'));
