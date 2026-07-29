-- Phase-2 360 order linkage: push/mirror bookkeeping.
ALTER TABLE orders ADD COLUMN pushed_to_360_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN synced_360_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN sync_360_error TEXT;
