CREATE TABLE IF NOT EXISTS contents (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) > 0),
  description TEXT NOT NULL CHECK (char_length(btrim(description)) > 0),
  media_key TEXT NOT NULL CHECK (char_length(btrim(media_key)) > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'ready'))
);
