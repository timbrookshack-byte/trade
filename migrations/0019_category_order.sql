-- Manual category ordering for storefront tiles (drag-and-drop in admin).
-- 1000 = "not ordered yet": sorts after ordered ones, then alphabetically.
ALTER TABLE category_settings ADD COLUMN position INTEGER NOT NULL DEFAULT 1000;
