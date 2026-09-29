-- Partner product feed: per-partner API keys for read-only catalogue access
-- (e.g. a trade customer listing our products on their own website).
-- Keys are shown once at creation and stored only as a SHA-256 hash.
CREATE TABLE partner_api_keys (
  id serial PRIMARY KEY,
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  include_trade_prices boolean NOT NULL DEFAULT FALSE,
  active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
