-- Products can appear in additional categories on the storefront (portal-owned
-- assignment; the primary category still comes from 360/Shopify sync).
ALTER TABLE products ADD COLUMN extra_categories JSONB NOT NULL DEFAULT '[]';
