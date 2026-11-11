-- Customer cards sync portal -> 360 (the portal masters trade customers).
-- synced_360_at tracks the last successful push; updated_at moving past it
-- re-queues the customer for the next sweep.
ALTER TABLE customers ADD COLUMN synced_360_at timestamptz;
