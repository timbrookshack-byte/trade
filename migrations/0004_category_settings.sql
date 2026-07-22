-- Category-level storefront controls: rename 360 categories for display and
-- hide whole categories from the storefront. Keyed by the raw 360 category
-- name; admin always works in raw names, the storefront shows display names.

CREATE TABLE category_settings (
  category TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
