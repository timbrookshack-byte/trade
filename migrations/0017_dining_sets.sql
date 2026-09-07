-- Dining set configurators (Shopify metafield/metaobject builder → portal).
-- A set = one fixed table + a chosen chair model × a chosen quantity.

CREATE TABLE dining_sets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,                 -- Shopify shell product handle
  title TEXT NOT NULL,
  table_product_title TEXT NOT NULL DEFAULT '',
  table_skus JSONB NOT NULL DEFAULT '[]',    -- [{sku, title}] (table variants)
  qty_options JSONB NOT NULL DEFAULT '[]',   -- e.g. [4, 6, 8]
  default_qty INTEGER NOT NULL DEFAULT 0,
  hero_image_url TEXT NOT NULL DEFAULT '',   -- pre-selection lifestyle image
  active BOOLEAN NOT NULL DEFAULT TRUE,      -- portal-owned; sync never touches
  discontinued_at TIMESTAMPTZ,               -- vanished from the Shopify feed
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dining_set_chairs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id BIGINT NOT NULL REFERENCES dining_sets(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,                      -- chair-option metaobject handle
  chair_product_title TEXT NOT NULL DEFAULT '',
  chair_skus JSONB NOT NULL DEFAULT '[]',    -- [{sku, title}] (chair colours)
  hero_image_url TEXT NOT NULL DEFAULT '',   -- composite table+chair photo
  tile_image_url TEXT NOT NULL DEFAULT '',   -- optional selector thumbnail
  position INTEGER NOT NULL DEFAULT 0,       -- metafield order; first = default
  UNIQUE (set_id, handle)
);

ALTER TABLE sync_runs DROP CONSTRAINT sync_runs_kind_check;
ALTER TABLE sync_runs ADD CONSTRAINT sync_runs_kind_check
  CHECK (kind IN ('shack360', 'shopify_bundles', 'dining_sets'));
