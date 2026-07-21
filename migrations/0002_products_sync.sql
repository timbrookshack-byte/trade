-- Milestone 2: products (360-synced + portal-only) and sync run history.

CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'shack360' CHECK (source IN ('shack360', 'portal')),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  dimensions TEXT NOT NULL DEFAULT '',
  cbm NUMERIC(10, 4),
  weight_kg NUMERIC(10, 2),
  image_url TEXT NOT NULL DEFAULT '',
  store_link TEXT NOT NULL DEFAULT '',
  -- RRP inc GST from 360, reference only. Trade price is portal data (inc GST).
  rrp_reference NUMERIC(12, 2),
  trade_price NUMERIC(12, 2),
  -- New 360 products arrive inactive with no trade price; the team activates
  -- them from the "New from 360" queue. Never auto-publish without a price.
  active BOOLEAN NOT NULL DEFAULT FALSE,
  available_now INTEGER NOT NULL DEFAULT 0,
  incoming JSONB NOT NULL DEFAULT '[]',
  stock_synced_at TIMESTAMPTZ,
  -- Set when the SKU vanishes from the 360 feed; cleared if it returns.
  discontinued_at TIMESTAMPTZ,
  -- Keys of locally-edited fields (e.g. {"description": true}) that sync must
  -- never overwrite.
  overrides JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX products_storefront_idx ON products (active) WHERE discontinued_at IS NULL;
CREATE INDEX products_category_idx ON products (category);

CREATE TABLE sync_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  trigger TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  products_in_feed INTEGER,
  created_count INTEGER,
  updated_count INTEGER,
  discontinued_count INTEGER,
  error TEXT
);
