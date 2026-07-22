-- Category header images + manual categories; customer last-login tracking
-- and invite/set-password tokens (for Orderspace-imported customers).

ALTER TABLE category_settings ADD COLUMN image_url TEXT NOT NULL DEFAULT '';

ALTER TABLE customers ADD COLUMN last_login_at TIMESTAMPTZ;

CREATE TABLE password_resets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_resets_customer_idx ON password_resets (customer_id);
