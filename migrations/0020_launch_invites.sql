-- Launch invite campaign: when each customer was sent their "set your
-- password" launch email, and their last order date in the OLD portal
-- (Orderspace CSV) so invites go to recently-active customers first.
ALTER TABLE customers ADD COLUMN invited_at timestamptz;
ALTER TABLE customers ADD COLUMN last_order_external date;
