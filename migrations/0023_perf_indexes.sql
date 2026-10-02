-- Performance indexes for the admin going slow at ~2,000 customers +
-- imported order history. Postgres does NOT index foreign keys or
-- expression lookups automatically.
CREATE INDEX IF NOT EXISTS customers_email_lower_idx ON customers (lower(email));
CREATE INDEX IF NOT EXISTS orders_customer_submitted_idx
  ON orders (customer_id, submitted_at DESC) WHERE status <> 'quote';
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);
CREATE INDEX IF NOT EXISTS password_resets_token_idx ON password_resets (token);
CREATE INDEX IF NOT EXISTS orders_sale_number_idx ON orders (sale_number_360);
