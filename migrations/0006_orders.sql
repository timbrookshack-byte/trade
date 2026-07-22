-- Milestone 4: orders (incl. quotes), order lines, payments.
-- No credit accounts: orders are invoiced and paid (EFT) before dispatch.

CREATE TABLE orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number TEXT UNIQUE,
  -- 'quote' is an order that hasn't been placed yet (admin-built, convertible).
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (
    status IN ('quote', 'submitted', 'confirmed', 'picking', 'dispatched', 'completed', 'cancelled')
  ),
  customer_id BIGINT REFERENCES customers(id),
  -- Snapshot of who the order/quote is for (works for prospects with no account).
  business_name TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  delivery_address TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  total_inc_gst NUMERIC(12, 2) NOT NULL DEFAULT 0,
  -- Phase-2 linkage to the sale created in 360.
  sale_number_360 TEXT,
  created_by_user_id BIGINT REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_customer_idx ON orders (customer_id);

CREATE TABLE order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_inc_gst NUMERIC(12, 2) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'eft' CHECK (method IN ('eft', 'card', 'cash', 'other')),
  amount NUMERIC(12, 2) NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by_user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payments_order_idx ON payments (order_id);
