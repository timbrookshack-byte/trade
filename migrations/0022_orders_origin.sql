-- Direct (in-store/phone) 360 sales imported into customer accounts.
-- origin: 'portal' = placed here; '360' = imported from 360's orders feed.
ALTER TABLE orders ADD COLUMN origin text NOT NULL DEFAULT 'portal';

-- One portal order per 360 sale on the import path (idempotent upserts).
CREATE UNIQUE INDEX orders_sale_360_unique
  ON orders (sale_number_360) WHERE origin = '360';
