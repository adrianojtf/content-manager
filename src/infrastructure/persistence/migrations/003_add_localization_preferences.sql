ALTER TABLE tenants
  ADD COLUMN default_locale TEXT,
  ADD COLUMN timezone TEXT,
  ADD COLUMN currency TEXT NOT NULL CHECK (char_length(currency) = 3);

ALTER TABLE users
  ADD COLUMN locale TEXT,
  ADD COLUMN timezone TEXT;
