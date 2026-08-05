-- Per-category tile layout: 'cover' crops/zooms to fill the tile (default),
-- 'contain' fits the whole image inside it.
ALTER TABLE category_settings ADD COLUMN image_fit TEXT NOT NULL DEFAULT 'cover'
  CHECK (image_fit IN ('cover', 'contain'));
