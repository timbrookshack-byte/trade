-- The first-order minimum spend is for NEW trade sign-ups only.
--
-- It shipped keyed off portal order history, which read every customer
-- migrated from the old ordering system as brand new — they'd traded with us
-- for years, just never through this portal. Mark existing clients explicitly
-- instead: everyone already in the portal is one, the CSV import flags future
-- imports, and a new application from the apply form defaults to FALSE.
ALTER TABLE customers ADD COLUMN existing_client BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE customers SET existing_client = TRUE;
