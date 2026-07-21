-- Milestone 3: trade customer accounts (storefront login + approval gate).

CREATE TABLE customers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_name TEXT NOT NULL,
  abn TEXT NOT NULL DEFAULT '',
  business_type TEXT NOT NULL DEFAULT 'retailer'
    CHECK (business_type IN ('retailer', 'interior_designer', 'commercial', 'hospitality', 'other')),
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  price_tier TEXT NOT NULL DEFAULT 'standard',
  credit_terms TEXT NOT NULL DEFAULT '',
  -- New registrations need admin approval before prices become visible.
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
