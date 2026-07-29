-- Delivery method + urgent-by date on orders. Freight cost stays TBA —
-- the team confirms it with the invoice.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS urgent_date DATE;
