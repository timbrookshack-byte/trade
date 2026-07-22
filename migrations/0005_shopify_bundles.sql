-- Shopify bundle sync: bundles come from the native Shopify Bundles app via
-- the Admin GraphQL API. Bundles are products with source='shopify'; their
-- component SKUs join to 360-synced products, and bundle available_now is
-- computed as min(floor(component stock / qty)) after every sync.

ALTER TABLE products DROP CONSTRAINT products_source_check;
ALTER TABLE products ADD CONSTRAINT products_source_check
  CHECK (source IN ('shack360', 'portal', 'shopify'));

CREATE TABLE bundle_components (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bundle_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_sku TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (bundle_id, component_sku)
);

-- Distinguish 360 product syncs from Shopify bundle syncs in the history.
ALTER TABLE sync_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'shack360'
  CHECK (kind IN ('shack360', 'shopify_bundles'));
