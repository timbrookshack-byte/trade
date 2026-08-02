-- Product image galleries (all Shopify images, not just the featured one).
ALTER TABLE products ADD COLUMN images JSONB NOT NULL DEFAULT '[]';
